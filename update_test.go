package main

import "testing"

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"v0.3.0", "v0.2.1", true},
		{"v0.10.0", "v0.9.2", true}, // by numbers, not by letters
		{"v1.0.0", "v0.99.99", true},
		{"v0.2.1", "v0.2.1", false},
		{"v0.2.0", "v0.2.1", false},
		{"v0.3.0", "v0.2.1-test", true},
		{"v0.3.0", "dev", false}, // a build from source gets no update notes
		{"tag", "v0.2.1", false},
		{"", "v0.2.1", false},
	} {
		if got := newer(c.a, c.b); got != c.want {
			t.Errorf("newer(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}
