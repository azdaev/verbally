package main

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Speech: who listens. Many users have a dictation app already: it hears them with a local model and pastes the text.
// When one runs, Verbally lets it listen: the page takes the pasted text as the phrase, and ⌥ only points (js/input.js).
// Without one, Verbally's own microphone works: Soniox with a key, or the recognizer of Chrome.
// VERBALLY_SPEECH=mic or VERBALLY_SPEECH=dictation wins over what is found.
//
// ponytail: a list of known apps, found by the name of their process. Add an app here when users ask for it.
var dictationApps = []struct{ in, bin, name, key string }{
	{"hex.app/", "hex", "Hex", "your Hex key (⌥ by default)"}, // in: a part of the macOS path; bin: the program name on Linux
	{"handy.app/", "handy", "Handy", ""},
	{"wispr flow", "", "Wispr Flow", ""},
	{"superwhisper", "", "Superwhisper", ""},
	{"voiceink", "", "VoiceInk", ""},
}

// dictationIn finds a dictation app in a list of running programs, one path or name per line.
func dictationIn(programs string) (name, key string) {
	for _, line := range strings.Split(strings.ToLower(programs), "\n") {
		line = strings.TrimSpace(line)
		for _, a := range dictationApps {
			if strings.Contains(line, a.in) || (a.bin != "" && filepath.Base(line) == a.bin) {
				return a.name, a.key
			}
		}
	}
	return "", ""
}

// hexKey reads the user's talk key from the settings of Hex. name is for the hint ("right ⌥").
// code is the browser's name of the key when it is one ⌥ of one side ("AltRight"): then the page can tell
// a press of the other ⌥, which points but which Hex does not hear.
func hexKey(settings []byte) (name, code string) {
	var s struct {
		Hotkey struct {
			Keys []struct{ Modifier, Side, Label string }
		} `json:"dictation_hotkey"`
	}
	if json.Unmarshal(settings, &s) != nil {
		return "", ""
	}
	keys := s.Hotkey.Keys
	signs := map[string]string{"option": "⌥", "command": "⌘", "control": "⌃", "shift": "⇧"}
	var parts []string
	for _, k := range keys {
		part := k.Label
		if k.Modifier != "" {
			part = signs[k.Modifier]
			if part == "" {
				part = k.Modifier
			}
			if k.Side == "left" || k.Side == "right" {
				part = k.Side + " " + part
			}
		}
		parts = append(parts, part)
	}
	if len(keys) == 1 && keys[0].Modifier == "option" {
		code = map[string]string{"left": "AltLeft", "right": "AltRight"}[keys[0].Side]
	}
	return strings.Join(parts, " "), code
}

// speech tells who listens now: "dictation" with the name of the app, or "mic".
func speech() map[string]string {
	out, _ := exec.Command("ps", "-axo", "comm=").Output()
	app, key := dictationIn(string(out))
	mode := os.Getenv("VERBALLY_SPEECH")
	if mode != "mic" && mode != "dictation" {
		mode = "mic"
		if app != "" {
			mode = "dictation"
		}
	}
	who := map[string]string{"speech": mode, "app": app, "key": key}
	var others []string // the known apps that do not run now: the settings show them, so the user sees that they work too
	for _, a := range dictationApps {
		if a.name != app {
			others = append(others, a.name)
		}
	}
	who["others"] = strings.Join(others, ", ")
	if app == "Hex" {
		dir, _ := os.UserHomeDir()
		settings, _ := os.ReadFile(filepath.Join(dir, "Library/Application Support/hex/settings.json"))
		if name, code := hexKey(settings); name != "" {
			who["key"], who["code"] = name, code
		}
	}
	return who
}

// setup tells the page who listens, and the tag of a newer release when there is one.
func setup(w http.ResponseWriter, r *http.Request) {
	out := speech()
	out["version"] = version
	out["engine"], _ = defaultEngine() // Startup already checks the default.
	for _, name := range []string{"claude", "codex"} {
		if _, err := exec.LookPath(name); err == nil {
			out[name] = "installed"
		}
	}
	out["recognizer"] = "Chrome" // of Verbally's own microphone
	if os.Getenv("SONIOX_API_KEY") != "" {
		out["recognizer"] = "Soniox"
	}
	if tag, ok := newTag.Load().(string); ok {
		out["update"] = tag
	}
	json.NewEncoder(w).Encode(out)
}
