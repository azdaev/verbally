package main

import "testing"

func TestDictationIn(t *testing.T) {
	for _, c := range []struct{ programs, want string }{
		{"/sbin/launchd\n/Applications/Hex.app/Contents/MacOS/hex\n/usr/bin/ssh", "Hex"},
		{"/Applications/Wispr Flow.app/Contents/MacOS/Wispr Flow", "Wispr Flow"},
		{"systemd\nhandy\nbash", "Handy"},
		{"/usr/bin/hexdump\n/Applications/Hexagon.app/Contents/MacOS/Hexagon", ""}, // a like name is no dictation app
		{"", ""},
	} {
		if got, _ := dictationIn(c.programs); got != c.want {
			t.Errorf("dictationIn(%q) = %q, want %q", c.programs, got, c.want)
		}
	}
}

func TestHexKey(t *testing.T) {
	for _, c := range []struct{ settings, name, code string }{
		{`{"dictation_hotkey":{"keys":[{"modifier":"option","side":"right"}]}}`, "right ⌥", "AltRight"},
		{`{"dictation_hotkey":{"keys":[{"modifier":"option","side":"any"}]}}`, "⌥", ""},
		{`{"dictation_hotkey":{"keys":[{"modifier":"control","side":"any"},{"code":49,"label":"Space"}]}}`, "⌃ Space", ""},
		{`{"dictation_hotkey":null}`, "", ""},
		{``, "", ""},
	} {
		if name, code := hexKey([]byte(c.settings)); name != c.name || code != c.code {
			t.Errorf("hexKey(%s) = %q, %q, want %q, %q", c.settings, name, code, c.name, c.code)
		}
	}
}
