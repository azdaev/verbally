// Verbally: serves the page and passes model requests to the local Claude Code CLI or to OpenRouter.
// The OpenRouter key stays out of the browser.
//
// Files:
//
//	main.go    start, routes, telemetry.jsonl, saved pages, the Soniox key
//	local.go   the guard of the port: only pages of this machine get an answer
//	speech.go  who listens: a dictation app that runs already, or Verbally's own microphone
//	claude.go  the Claude Code engine: a spare process, the cap on parallel work, MCP and tool setup
//	triage.go  Jev: filler, look, versions, and which section a phrase goes to
//	screen.go  a screenshot of the page window for "this looks bad"
//	photo.go   /photo: Wikimedia search and copies of web images
//	code.go    code mode: read, write and undo the source files of an app
//	code/dev.mjs + overlay.js + js/code.js + prompt-code.txt: code mode, Verbally as a widget on the app's dev server
//	prompt.txt the system prompt of the design model
//	index.html + ui.css + js/: the page (core, page, model, picker, input, main; loaded in that order)
//	stats.py   a summary of telemetry.jsonl
//
// Run:
//
//	verbally                      a new page, made by voice
//	verbally <app folder> [port]  code mode: the Vite + React app in that folder, with the bar on top
//	verbally doctor               what this machine has and what it lacks
//
// Work on Verbally itself: VERBALLY_DEV=1 go run . serves the files of this folder, not the copies inside the program.
// Optional keys, as environment variables: SONIOX_API_KEY (speech), TYPESAFE_API_KEY (Jev), OPENROUTER_API_KEY (?engine=openrouter).
package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The program holds its own page files, so one file is the whole install.
//
//go:embed index.html ui.css overlay.js js lib prompt.txt prompt-code.txt code/dev.mjs pinterest.sh
var bundled embed.FS

// toolFS: the files of the page. VERBALLY_DEV=1 takes them from the current folder, so a change shows without a build.
var toolFS fs.FS = bundled

var version = "dev" // a release sets it: -ldflags "-X main.version=v0.1.0"

const usage = `Verbally: change a web page with your voice.

  verbally                      a new page, made by voice
  verbally <app folder> [port]  code mode: the Vite + React app in that folder, with the bar on top (port 5180)
  verbally doctor               what this machine has and what it lacks
  verbally version

Hold Option and talk. Point with the mouse while you hold it.
`

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

// files serves the tool. With VERBALLY_SITE=folder it also serves an existing static site to edit:
// /api/site gives the site's index.html, and an address that the tool does not have comes from the site folder,
// so the site's own images, fonts and CSS work at their usual paths (/landing-assets/...).
func files(site string) http.Handler {
	// no-cache: the browser asks each time whether a file changed. Without it Chrome keeps an old js/ file after an update.
	files := http.FileServerFS(toolFS)
	tool := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	if site == "" {
		return tool
	}
	theirs := http.FileServer(http.Dir(site))
	http.HandleFunc("GET /api/site", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, filepath.Join(site, "index.html")) })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "."
		}
		if _, err := fs.Stat(toolFS, name); err == nil {
			tool.ServeHTTP(w, r)
			return
		}
		theirs.ServeHTTP(w, r)
	})
}

// home moves the server into its own folder (~/.verbally, or VERBALLY_HOME). telemetry.jsonl, pages/, photos/ and
// engine-mcp.json live there, not in the project of the user. It returns the path of the dev server script.
func home() string {
	dir := os.Getenv("VERBALLY_HOME")
	if dir == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			log.Fatal(err)
		}
		dir = filepath.Join(h, ".verbally")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		log.Fatal(err)
	}
	// The engine runs ./pinterest.sh, and node runs dev.mjs: both need a real file.
	for from, to := range map[string]string{"pinterest.sh": "pinterest.sh", "code/dev.mjs": "dev.mjs"} {
		body, _ := bundled.ReadFile(from)
		if err := os.WriteFile(to, body, 0o755); err != nil {
			log.Fatal(err)
		}
	}
	return filepath.Join(dir, "dev.mjs")
}

// doctor prints what this machine has. It returns 1 when the engine is missing: then nothing works.
func doctor() int {
	bad := 0
	has := func(name, use string, must bool) {
		if p, err := exec.LookPath(name); err == nil {
			fmt.Printf("ok       %-11s %s\n", name, p)
		} else if must {
			bad = 1
			fmt.Printf("MISSING  %-11s %s\n", name, use)
		} else {
			fmt.Printf("no       %-11s optional: %s\n", name, use)
		}
	}
	has("claude", "the engine. Install Claude Code: https://claude.com/claude-code", true)
	has("node", "code mode, the bar on a running Vite + React app", false)
	has("playwriter", "photos from Pinterest and other sites that block plain requests", false)
	if runtime.GOOS == "darwin" {
		has("swiftc", `a screenshot for "this looks bad". Install: xcode-select --install`, false)
	} else {
		fmt.Printf("no       %-11s macOS only: the model gets no picture of the screen here\n", "screenshot")
	}
	if s := speech(); s["app"] != "" {
		fmt.Printf("ok       %-11s %s runs: it listens, and Verbally takes its text (speech: %s)\n", "dictation", s["app"], s["speech"])
	} else {
		fmt.Printf("no       %-11s optional: a dictation app with a local model (Hex, Handy, Wispr Flow). Without one Verbally's own microphone works\n", "dictation")
	}
	for _, k := range [][2]string{{"SONIOX_API_KEY", "better speech recognition; without it the recognizer of Chrome works"},
		{"TYPESAFE_API_KEY", "Jev, the fast model that sorts phrases; without it key-word rules work"},
		{"OPENROUTER_API_KEY", "?engine=openrouter"}} {
		if os.Getenv(k[0]) != "" {
			fmt.Printf("ok       %s\n", k[0])
		} else {
			fmt.Printf("no       %-11s optional: %s\n", k[0], k[1])
		}
	}
	if bad == 0 {
		fmt.Println("\nReady. Run: verbally <app folder>")
	}
	return bad
}

// folder gives the full path of a folder that the user named. It must be read before home() changes the current folder.
func folder(name string) string {
	if name == "" {
		return ""
	}
	full, err := filepath.Abs(name)
	if info, serr := os.Stat(full); err != nil || serr != nil || !info.IsDir() {
		fmt.Fprintf(os.Stderr, "verbally: %q is not a folder\n\n%s", name, usage)
		os.Exit(2)
	}
	return full
}

func main() {
	arg, port := "", "5180"
	if len(os.Args) > 1 {
		arg = os.Args[1]
	}
	if len(os.Args) > 2 {
		port = os.Args[2]
	}
	switch arg {
	case "doctor":
		os.Exit(doctor())
	case "version", "--version", "-v":
		fmt.Println(version)
		return
	case "help", "--help", "-h":
		fmt.Print(usage)
		return
	}
	// `verbally <app>` starts the app's dev server too. VERBALLY_CODE=<app> only opens the files: start code/dev.mjs by hand.
	app, site := folder(arg), folder(os.Getenv("VERBALLY_SITE"))
	if app == "" {
		app = folder(os.Getenv("VERBALLY_CODE"))
	}
	dev, script := os.Getenv("VERBALLY_DEV") != "", "code/dev.mjs"
	if dev {
		devMode = true
		toolFS = os.DirFS(".")
	} else {
		script = home()
	}
	key := os.Getenv("OPENROUTER_API_KEY")
	if _, err := exec.LookPath("claude"); err != nil && key == "" {
		log.Fatal("no engine: the Claude Code CLI is not on this machine. Install it (https://claude.com/claude-code), then run: verbally doctor")
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
	http.HandleFunc("GET /api/setup", setup)
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
	codeRoutes(app)
	http.Handle("/", files(site))
	// Localhost only, and only for pages of this machine (local.go): anyone who reaches this port spends the key.
	addr := "127.0.0.1:" + serverPort()
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err, ". Another Verbally runs already? Stop it, or set VERBALLY_PORT and give the app another port: verbally <app> 5190")
	}
	go func() { log.Fatal(http.Serve(listener, local(http.DefaultServeMux))) }()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if arg == "" { // page mode
		log.Println("http://" + addr)
		if !dev {
			open("http://" + addr)
		}
		<-ctx.Done()
		return
	}
	// Code mode: the app's own dev server, with the marks and the bar (code/dev.mjs). It stops with this program.
	node := exec.CommandContext(ctx, "node", script, app, port)
	node.Stdout, node.Stderr = os.Stdout, os.Stderr
	node.Env = append(os.Environ(), "VERBALLY_PORT="+serverPort())
	if !dev {
		node.Env = append(node.Env, "VERBALLY_OPEN=1")
	}
	if err := node.Run(); err != nil && ctx.Err() == nil {
		log.Fatal("the app's dev server stopped: ", err, ". Code mode needs Node and a Vite + React app; run: verbally doctor")
	}
}

// serverPort: VERBALLY_PORT moves the server from 8787, when that port is taken or a second Verbally runs.
func serverPort() string {
	if p := os.Getenv("VERBALLY_PORT"); p != "" {
		return p
	}
	return "8787"
}

// open shows an address in the user's browser. BROWSER=none switches it off, as in Vite.
func open(address string) {
	if os.Getenv("BROWSER") == "none" {
		return
	}
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	exec.Command(name, address).Start()
}
