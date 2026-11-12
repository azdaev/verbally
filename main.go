// Verbally: serves the page and passes model requests to the local Claude Code CLI or to OpenRouter.
// The OpenRouter key stays out of the browser.
// Run: go run .
// For Soniox speech recognition set SONIOX_API_KEY first: set -a; source ~/.config/verbally/soniox.env; set +a
// For the Jev triage set TYPESAFE_API_KEY first: set -a; source ~/.config/verbally/typesafe.env; set +a
// For ?engine=openrouter set the key first: set -a; source ~/.config/jarvey/openrouter-eval.env; set +a
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// logEvent adds one line to telemetry.jsonl. The file holds speech text and timings; it stays on this machine.
// Read it with: python3 stats.py
var logMu sync.Mutex

func logEvent(v map[string]any) {
	v["at"] = time.Now().Format("2006-01-02T15:04:05.000Z07:00")
	line, _ := json.Marshal(v)
	logMu.Lock()
	defer logMu.Unlock()
	f, err := os.OpenFile("telemetry.jsonl", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		log.Println("telemetry:", err)
		return
	}
	defer f.Close()
	f.Write(append(line, '\n'))
}

func main() {
	key := os.Getenv("OPENROUTER_API_KEY")
	if key == "" {
		log.Println("OPENROUTER_API_KEY is not set: only the local Claude Code engine works")
	}
	target, _ := url.Parse("https://openrouter.ai")
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.URL.Path = "/api/v1/chat/completions"
			r.Out.Header.Set("Authorization", "Bearer "+key)
		},
		FlushInterval: -1, // send each token at once
	}
	http.Handle("POST /api/chat", proxy)
	http.HandleFunc("POST /api/claude", claudeChat)
	http.HandleFunc("GET /photo", photo)
	http.HandleFunc("POST /api/triage", triage)
	go winBin() // build the window finder now, not at the first screenshot
	http.HandleFunc("POST /api/page", func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.URL.Query().Get("name")) // Base keeps the file inside pages/
		body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil || name == "." || name == "/" {
			http.Error(w, "bad page", http.StatusBadRequest)
			return
		}
		os.MkdirAll("pages", 0o700)
		os.WriteFile(filepath.Join("pages", name+".json"), body, 0o600)
	})
	http.HandleFunc("POST /api/log", func(w http.ResponseWriter, r *http.Request) {
		var v map[string]any
		if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&v) == nil {
			v["src"] = "page"
			logEvent(v)
		}
	})
	// The browser talks to Soniox directly. It gets a key that lives 10 minutes; the real key stays here.
	http.HandleFunc("GET /api/soniox", func(w http.ResponseWriter, r *http.Request) {
		req, _ := http.NewRequestWithContext(r.Context(), "POST", "https://api.soniox.com/v1/auth/temporary-api-key",
			bytes.NewReader([]byte(`{"usage_type":"transcribe_websocket","expires_in_seconds":600}`)))
		req.Header.Set("Authorization", "Bearer "+os.Getenv("SONIOX_API_KEY"))
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer res.Body.Close()
		w.WriteHeader(res.StatusCode) // 401 tells the page to use the browser recognizer
		io.Copy(w, res.Body)
	})
	http.Handle("/", http.FileServer(http.Dir(".")))
	// Localhost only: anyone who reaches this port spends the key.
	const addr = "127.0.0.1:8787"
	log.Println("http://" + addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
