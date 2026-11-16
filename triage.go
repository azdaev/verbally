package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
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

// Routing: a page is a list of sections, and each phrase changes one of them. The page sends the names of its sections.
// Jev tells where the phrase goes: to a new section, to every section, or to the section that the phrase names.
// No clear answer gives no target: then the page takes the section that the user points at or looks at.
const (
	askNew = "A user speaks to a tool that edits a web page. Does the speaker ask to add a whole new section or block to the page (a footer, a pricing block, a gallery, \"one more section\")? Answer no when the speaker changes, redoes, moves or removes a thing that is on the page, and no for a small new element (a button, an icon, a photo, a link, a word)."
	askAll = "A user speaks to a tool that edits a web page. Does the speaker ask for one change of the whole page, the whole site or every section (the font everywhere, all colours, tidy the site, fix everything)? Answer no when the speech is about one section or one element."
)

func triage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text     string   `json:"text"`
		Sections []string `json:"sections"` // a short name of each section, top to bottom
	}
	json.NewDecoder(r.Body).Decode(&in)
	out := map[string]any{"filler": false, "look": false, "versions": false}
	defer func() { json.NewEncoder(w).Encode(out) }()
	if in.Text == "" {
		return
	}
	key := os.Getenv("TYPESAFE_API_KEY")
	if key == "" {
		out = rules(in.Text, in.Sections)
		return
	}
	t0 := time.Now()
	var questions map[string]map[string]string
	json.Unmarshal([]byte(triageQuestions), &questions)
	if len(in.Sections) > 0 {
		questions["new"] = map[string]string{"type": "noul", "instructions": askNew}
		questions["all"] = map[string]string{"type": "noul", "instructions": askAll}
		list := ""
		for i, name := range in.Sections {
			list += fmt.Sprintf("%d. %s\n", i+1, name)
		}
		for i := range in.Sections {
			questions[fmt.Sprint("s", i)] = map[string]string{"type": "noul", "instructions": fmt.Sprintf(
				"A user speaks to a tool that edits a web page. The sections of the page, top to bottom:\n%sDoes the speaker name section %d as the place of the change, by its name, its content or its position (first, last, top, bottom)? Answer no when the speech names no section.", list, i+1)}
		}
	}
	body, _ := json.Marshal(map[string]any{"model": "jev-latest", "state": in.Text, "questions": questions})
	req, _ := http.NewRequestWithContext(r.Context(), "POST", "https://api.typesafe.ai/v1/systemone", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	res, err := jev.Do(req)
	if err != nil {
		logEvent(map[string]any{"src": "server", "event": "triage_failed", "error": err.Error()})
		out = rules(in.Text, in.Sections)
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
	ev := map[string]any{"src": "server", "event": "triage", "text": in.Text, "filler": f, "look": l, "versions": v}
	// The target is the best answer over the limit. A named section wins over "new" and "all" at the same score.
	best := 0.6
	for i := range in.Sections {
		if s := got.Answers[fmt.Sprint("s", i)].Noul; s >= best {
			best, out["target"] = s, i
		}
	}
	for _, k := range []string{"new", "all"} {
		ev[k] = got.Answers[k].Noul
		if s := got.Answers[k].Noul; s > best {
			best, out["target"] = s, k
		}
	}
	ev["target"], ev["ms"] = out["target"], time.Since(t0).Milliseconds()
	logEvent(ev)
}
