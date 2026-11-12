package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Triage: before a phrase goes to Claude, the fast model Jev answers two yes/no questions about it.
//
//	filler - the phrase holds nothing to act on ("okay", "uh"). The page drops it, so Claude does not spend 2-3 s on it.
//	look   - the phrase judges the look of the page ("this is ugly"). Then Claude gets a screenshot with the phrase.
//	versions - the phrase asks for several layouts to choose from. Then the page builds them side by side.
//
// The limits come from a test on 30 phrases: real commands got at most 0.52 for filler, exact instructions at most 0.56 for look.
// Any error means "not filler, do not look": a lost network must never drop a command.
const triageQuestions = `{
"filler": {"type": "noul", "instructions": "A user speaks to a tool that edits a web page. Is this speech only filler, a thinking sound or an unfinished start, with nothing to act on? A complaint about the page (\"this is ugly\", \"this photo is bad\") is something to act on, so answer no for it."},
"look": {"type": "noul", "instructions": "A user speaks to a tool that edits a web page. Does the speaker judge how the page looks, or ask to check, tidy or improve its look, without saying exactly what to change? Then one must see the page to act. Answer no for an exact instruction like \"make the heading green\" or \"add a button\"."},
"versions": {"type": "noul", "instructions": "A user speaks to a tool that edits a web page. Does the speaker ask for several versions, options, variants or ideas of a layout, a design or a section, to choose one of them? Answer no when the speaker asks for versions of a photo or an image only, and no for a single change."}
}`

var jev = &http.Client{Timeout: 1500 * time.Millisecond}

func triage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text string `json:"text"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	out := map[string]any{"filler": false, "look": false, "versions": false}
	defer func() { json.NewEncoder(w).Encode(out) }()
	key := os.Getenv("TYPESAFE_API_KEY")
	if key == "" || in.Text == "" {
		return
	}
	t0 := time.Now()
	body, _ := json.Marshal(map[string]any{"model": "jev-latest", "state": in.Text, "questions": json.RawMessage(triageQuestions)})
	req, _ := http.NewRequestWithContext(r.Context(), "POST", "https://api.typesafe.ai/v1/systemone", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	res, err := jev.Do(req)
	if err != nil {
		logEvent(map[string]any{"src": "server", "event": "triage_failed", "error": err.Error()})
		return
	}
	defer res.Body.Close()
	var got struct {
		Answers map[string]struct {
			Noul float64 `json:"noul"`
		} `json:"answers"`
	}
	json.NewDecoder(res.Body).Decode(&got)
	f, l, v := got.Answers["filler"].Noul, got.Answers["look"].Noul, got.Answers["versions"].Noul
	out["filler"], out["versions"] = f >= 0.8, f < 0.8 && v >= 0.6
	out["look"] = f < 0.8 && v < 0.6 && l >= 0.6
	logEvent(map[string]any{"src": "server", "event": "triage", "text": in.Text, "filler": f, "look": l, "versions": v, "ms": time.Since(t0).Milliseconds()})
}

// The screenshot is the browser window whose title holds the name that the page gave itself.
// So Claude sees what the user sees: the part of the page that is on screen now.
// A small Swift program finds the window number. It is built once, because `swift -e` needs a second for each run.
const winSrc = `import CoreGraphics
let l = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in l where ((w["kCGWindowName"] as? String) ?? "").contains(CommandLine.arguments[1]) { print(w["kCGWindowNumber"]!); break }
`

var winBin = sync.OnceValue(func() string {
	src, bin := filepath.Join(os.TempDir(), "verbally-winid.swift"), filepath.Join(os.TempDir(), "verbally-winid")
	os.WriteFile(src, []byte(winSrc), 0o600)
	if exec.Command("swiftc", "-O", "-o", bin, src).Run() != nil {
		return ""
	}
	return bin
})

// screenshot returns the window as a base64 JPEG, at most 1568 px wide: enough to judge a layout, small enough to be fast.
func screenshot(title string) (string, error) {
	if winBin() == "" || !strings.HasPrefix(title, "Verbally") {
		return "", errors.New("no window finder")
	}
	id, _ := exec.Command(winBin(), title).Output()
	if len(bytes.TrimSpace(id)) == 0 {
		return "", errors.New("the window is not on screen")
	}
	f, err := os.CreateTemp("", "verbally-*.jpg")
	if err != nil {
		return "", err
	}
	f.Close()
	defer os.Remove(f.Name())
	if err := exec.Command("screencapture", "-x", "-o", "-l", string(bytes.TrimSpace(id)), "-t", "jpg", f.Name()).Run(); err != nil {
		return "", err
	}
	exec.Command("sips", "-Z", "1568", f.Name()).Run()
	img, err := os.ReadFile(f.Name())
	return base64.StdEncoding.EncodeToString(img), err
}
