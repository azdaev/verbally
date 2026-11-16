package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

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

type rect struct{ X, Y, W, H int }

// shotRect returns a part of the screen as a base64 JPEG: the zone that the user drew around with the mouse.
func shotRect(r rect) (string, error) {
	if r.W < 8 || r.H < 8 || r.W > 8000 || r.H > 8000 {
		return "", errors.New("bad zone")
	}
	f, err := os.CreateTemp("", "verbally-*.jpg")
	if err != nil {
		return "", err
	}
	f.Close()
	defer os.Remove(f.Name())
	if err := exec.Command("screencapture", "-x", "-R", fmt.Sprintf("%d,%d,%d,%d", r.X, r.Y, r.W, r.H), "-t", "jpg", f.Name()).Run(); err != nil {
		return "", err
	}
	exec.Command("sips", "-Z", "1568", f.Name()).Run()
	img, err := os.ReadFile(f.Name())
	return base64.StdEncoding.EncodeToString(img), err
}
