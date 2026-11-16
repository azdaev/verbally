package main

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

// local lets in only the pages of this machine. Without it any web site that the user has open could call this port:
// write the files of the app, or give a prompt to a Claude Code process that runs every tool without a question.
//
//   - Host must be a name of this machine. A foreign name that points at 127.0.0.1 (DNS rebinding) fails here.
//   - The page that asks must be a page of this machine. The browser names it in Origin (a POST) or in Referer (a GET).
//   - A foreign page can hide its address, but not the fact that it is another site: the browser adds Sec-Fetch-Site by itself.
//     A browser extension that opens the page (Playwriter, a test) looks the same as that foreign page.
//     So such a request may only open the plain page. An address with settings can hold the test hooks
//     (?say= gives speech to the engine, ?mic= switches the microphone on): that one must come from the address bar.
//     VERBALLY_DEV=1 lets a test open any address.
//
// A program on this machine (curl, a test) and the address bar send none of these and get in.
var devMode bool

func local(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		opens := r.Method == "GET" && r.Header.Get("Sec-Fetch-Mode") == "navigate" && (r.URL.RawQuery == "" || devMode)
		if !allowed(r.Host, r.Header.Get("Origin"), r.Header.Get("Referer"), r.Header.Get("Sec-Fetch-Site"), opens) {
			http.Error(w, "Verbally answers only to pages of this machine. Type this address into the address bar.", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// allowed: `opens` tells that the request only opens the plain page.
func allowed(host, origin, referer, site string, opens bool) bool {
	if !loopback(host) {
		return false
	}
	from := origin
	if from == "" {
		from = referer
	}
	if from == "" {
		return site != "cross-site" || opens
	}
	u, err := url.Parse(from)
	return err == nil && loopback(u.Host)
}

// loopback tells if a host, with or without a port, names this machine.
func loopback(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
