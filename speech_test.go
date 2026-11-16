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
