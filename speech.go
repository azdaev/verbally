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
	return map[string]string{"speech": mode, "app": app, "key": key}
}

// setup tells the page who listens, and the tag of a newer release when there is one.
func setup(w http.ResponseWriter, r *http.Request) {
	out := speech()
	out["version"] = version
	if tag, ok := newTag.Load().(string); ok {
		out["update"] = tag
	}
	json.NewEncoder(w).Encode(out)
}
