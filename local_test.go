package main

import "testing"

func TestAllowed(t *testing.T) {
	const own, app, evil = "http://127.0.0.1:8787", "http://localhost:5180", "https://evil.example"
	for _, c := range []struct {
		name                        string
		host, origin, referer, site string
		opens                       bool // the request only opens the plain page
		want                        bool
	}{
		{"curl", "127.0.0.1:8787", "", "", "", false, true},
		{"the address bar", "127.0.0.1:8787", "", "", "none", true, true},
		{"the tool's own page reads a file", "127.0.0.1:8787", "", own + "/", "same-origin", false, true},
		{"the tool's own page posts", "127.0.0.1:8787", own, own + "/", "same-origin", false, true},
		{"code mode, through the app's dev server", "localhost:5180", app, app + "/", "same-origin", false, true},
		{"a link from the app to the tool", "127.0.0.1:8787", "", app + "/", "cross-site", true, true},
		{"IPv6", "[::1]:8787", "http://[::1]:8787", "", "same-origin", false, true},
		{"a foreign page posts a file or a prompt", "127.0.0.1:8787", evil, evil + "/", "cross-site", false, false},
		{"the same from an old browser", "127.0.0.1:8787", evil, "", "", false, false},
		{"a link or an image on a foreign page", "127.0.0.1:8787", "", evil + "/", "cross-site", true, false},
		{"a foreign page that hides its address, with ?say=", "127.0.0.1:8787", "", "", "cross-site", false, false},
		{"an extension or a foreign link opens the plain page", "127.0.0.1:8787", "", "", "cross-site", true, true},
		{"DNS rebinding", "evil.example:8787", "http://evil.example:8787", "", "same-origin", true, false},
		{"a sandboxed frame or a local file", "127.0.0.1:8787", "null", "", "", false, false},
		{"a look-alike name", "127.0.0.1.evil.example", "", "", "", true, false},
	} {
		if got := allowed(c.host, c.origin, c.referer, c.site, c.opens); got != c.want {
			t.Errorf("%s: allowed(%q, %q, %q, %q, %v) = %v, want %v", c.name, c.host, c.origin, c.referer, c.site, c.opens, got, c.want)
		}
	}
}
