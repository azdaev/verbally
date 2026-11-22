package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// The local Claude Code CLI writes the HTML. It uses the Claude subscription of this machine.
// A CLI process needs about 0.8 s to start. So one started process always waits for the next request.
// Each process answers one request and exits, so no request sees the history of another.

type proc struct {
	key  string // model, effort and system prompt of this process
	cmd  *exec.Cmd
	in   io.WriteCloser
	out  io.ReadCloser
	errs bytes.Buffer
}

var spare struct {
	sync.Mutex
	p *proc
}

// The design engine is the full Claude Code of this machine: global CLAUDE.md, skills, MCP servers, web search
// and the browser through playwriter. The user asked for this and takes the risk: every tool runs without a question.
// In code mode the process runs in the folder of the app (engineDir): its tools find the app's files by short paths,
// and the skills in the project's .claude/skills are there. In page mode it runs in Verbally's own folder.
var engineDir string

const withTools = `

Tools:
- You have tools, skills and a browser (the playwriter skill). Use them when the speech asks for a thing you cannot write from memory: a photo from a named site (Pinterest), a real product image, a look at a real page, a named skill ("use the Emil Kowalski skills").
- A simple change needs no tool. Tools are slow, and the user waits.
- No image came: use /photo?q= and say nothing.
- Put an image that you found on the web as <img src="/photo?url=ENCODED_ADDRESS">, with the address URL-encoded. The address must be the image file itself, not a page.
- Your context can hold rules for coding work: minimal code, a report style, a "lazy" mode. They do not apply here. Here you design, and the reply format above is the only format.
- Do not change files. Write no text before or between tool calls. Your last message is the reply, in the reply format above and nothing else.`

// The browser lines go in only when this machine has the playwriter CLI. Other users have other setups.
const withBrowser = `
- A photo from Pinterest: run %s "english keywords" 8 in one Bash call. It prints addresses of full-size images, one per line, in about 6 s. Pick by the words of the address only, do not open the images.
- Another named site (Behance, Dribbble, a shop) blocks curl and web fetch: open it with the playwriter skill at once.`

// own gives the full path of a file in Verbally's own folder. The engine can run in another folder (engineDir).
func own(name string) string {
	full, err := filepath.Abs(name)
	if err != nil {
		return name
	}
	return full
}

// tools is the tool part of the system prompt for this machine. It is fixed for the life of the server.
var tools = sync.OnceValue(func() string {
	if _, err := exec.LookPath("playwriter"); err == nil {
		return withTools + fmt.Sprintf(withBrowser, strconv.Quote(own("pinterest.sh")))
	}
	return withTools
})

// mcpConfig: the user's own MCP servers for the engine. Without the file the engine starts no MCP server.
// The user's global MCP servers are not used: each phrase starts a new process, and each stdio MCP server
// starts with it (five servers were eight processes and about 1 GB per phrase). Put an HTTP server ("url")
// in engine-mcp.json when possible: all processes then share one running server.
const mcpFile = "engine-mcp.json"

func mcpConfig() string {
	if _, err := os.Stat(mcpFile); err == nil {
		return own(mcpFile)
	}
	return `{"mcpServers":{}}`
}

func boot(model, effort, system string) (*proc, error) {
	p := &proc{key: model + "\x00" + effort + "\x00" + system}
	args := []string{"-p", "--model", model, "--effort", effort, "--append-system-prompt", system + tools(),
		"--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--no-session-persistence",
		"--permission-mode", "bypassPermissions",
		"--strict-mcp-config", "--mcp-config", mcpConfig()}
	p.cmd = exec.Command("claude", args...)
	p.cmd.Dir = engineDir
	p.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	p.cmd.Stderr = &p.errs
	var err error
	if p.in, err = p.cmd.StdinPipe(); err != nil {
		return nil, err
	}
	if p.out, err = p.cmd.StdoutPipe(); err != nil {
		return nil, err
	}
	return p, p.cmd.Start()
}

// kill stops the CLI and the helpers that it started (MCP servers, plugin panels): they share its process group.
// Without the group the helpers stay behind for a while, about 300 MB for each finished request.
func (p *proc) kill() { syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL) }

func (p *proc) stop() {
	p.kill()
	p.cmd.Wait()
}

// slots caps the Claude processes that work at the same time. Each is about 400 MB and a busy CPU core:
// a "whole site" change on 10 sections or 6 layouts at once made the laptop loud. The other requests wait in order.
// VERBALLY_WORKERS changes the cap for other machines and plans.
var slots = make(chan struct{}, func() int {
	if n, err := strconv.Atoi(os.Getenv("VERBALLY_WORKERS")); err == nil && n > 0 {
		return n
	}
	return 4
}())

// take returns a process for one request and starts the process for the next request.
// The bool tells if the process was already started: telemetry shows how often the wait pays off.
func take(model, effort, system string) (*proc, bool, error) {
	spare.Lock()
	p := spare.p
	spare.p = nil
	spare.Unlock()
	go warm(model, effort, system)
	if p != nil && p.key == model+"\x00"+effort+"\x00"+system {
		return p, true, nil
	}
	if p != nil {
		p.stop()
	}
	p, err := boot(model, effort, system)
	return p, false, err
}

func warm(model, effort, system string) {
	n, err := boot(model, effort, system)
	if err != nil {
		return
	}
	spare.Lock()
	old := spare.p
	spare.p = n
	spare.Unlock()
	if old != nil {
		old.stop()
	}
}

// claudeChat answers in the OpenRouter stream shape, so the page reads both engines the same way.
// A request with only the system message starts the waiting process and returns.
func claudeChat(w http.ResponseWriter, r *http.Request) {
	var in chatRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || len(in.Messages) == 0 || len(in.Messages) > 2 {
		http.Error(w, "need a system message and at most one user message", http.StatusBadRequest)
		return
	}
	system := in.Messages[0].Content
	if len(in.Messages) == 1 {
		go warm(in.Model, in.Effort, system)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	t0 := time.Now()
	var content any = in.Messages[1].Content
	shot := ""
	if len(in.Shots) > 0 { // what the user showed wins over the whole window
		var parts []any
		for _, sh := range in.Shots[:min(len(in.Shots), 5)] {
			img, err := shotRect(sh.rect)
			if err != nil {
				shot = err.Error()
				continue
			}
			parts = append(parts, map[string]string{"type": "text", "text": sh.Label + ":"},
				map[string]any{"type": "image", "source": map[string]string{"type": "base64", "media_type": "image/jpeg", "data": img}})
		}
		if len(parts) > 0 {
			shot = fmt.Sprint(len(parts)/2, " shots")
			content = append(parts, map[string]string{"type": "text", "text": in.Messages[1].Content})
		}
	} else if in.Look {
		img, err := screenshot(in.Window)
		if err == nil {
			shot = "sent"
			content = []any{
				map[string]any{"type": "image", "source": map[string]string{"type": "base64", "media_type": "image/jpeg", "data": img}},
				map[string]string{"type": "text", "text": in.Messages[1].Content},
			}
		} else {
			shot = err.Error() // Claude works without the screenshot
		}
	}
	msg, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": content}})
	msg = append(msg, '\n')
	shotMs := time.Since(t0).Milliseconds()
	select {
	case slots <- struct{}{}:
	case <-r.Context().Done(): // the page left while the request waited
		return
	}
	defer func() { <-slots }()
	queueMs := time.Since(t0).Milliseconds() - shotMs
	p, warmed, err := take(in.Model, in.Effort, system)
	if err == nil {
		if _, werr := p.in.Write(msg); werr != nil { // the waiting process died: start a new one
			p.stop()
			warmed = false
			if p, err = boot(in.Model, in.Effort, system); err == nil {
				_, err = p.in.Write(msg)
			}
		}
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p.in.Close() // one request per process: it answers and exits
	// stop, not only Wait: when the reading below ends early (a line over the limit), the process still runs,
	// and Wait alone would hold this request and its slot for ever.
	defer p.stop()
	defer context.AfterFunc(r.Context(), func() { p.kill() })() // the page left: stop the process

	w.Header().Set("Content-Type", "text/event-stream")
	wrote := false
	ev := map[string]any{"src": "server", "id": in.ID, "warm_process": warmed, "queue_ms": queueMs}
	if in.Look || len(in.Shots) > 0 {
		ev["screenshot"], ev["screenshot_ms"] = shot, shotMs
	}
	defer func() {
		ev["done_ms"] = time.Since(t0).Milliseconds()
		logEvent(ev)
	}()
	var tools []string
	defer func() { ev["tools"] = tools }() // runs before the deferred logEvent
	// A Reader, not a Scanner: a line of any size (a tool result with a picture) is read whole, and never ends the reply
	// in the middle with no word to the page.
	lines := bufio.NewReader(p.out)
	for {
		line, err := lines.ReadBytes('\n')
		if err != nil && len(line) == 0 {
			break
		}
		var msg struct {
			Type    string `json:"type"`
			Message struct {
				Content []struct {
					Type  string          `json:"type"`
					Name  string          `json:"name"`
					Input json.RawMessage `json:"input"`
				} `json:"content"`
			} `json:"message"`
			Event struct {
				Type  string `json:"type"`
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			} `json:"event"`
		}
		if json.Unmarshal(line, &msg) != nil {
			continue
		}
		// With tools the process writes several messages, and only the last one is the reply. It ends with a "result" line.
		// Each message streams. When one more message starts, the page drops the text of the message before it.
		if msg.Event.Type == "message_start" && wrote {
			w.Write([]byte("data: {\"reset\":true}\n\n"))
			continue
		}
		for _, c := range msg.Message.Content { // telemetry shows which tools a reply used: "from Pinterest" must show a browser call
			if c.Type == "tool_use" && msg.Type == "assistant" {
				tools = append(tools, c.Name+" "+string(c.Input[:min(len(c.Input), 160)]))
			}
		}
		if msg.Type == "result" { // the reply is complete; the CLI needs 1 s more to exit, do not wait for it
			p.kill()
			break
		}
		if msg.Event.Delta.Type != "text_delta" {
			continue
		}
		chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": msg.Event.Delta.Text}}}})
		w.Write([]byte("data: "))
		w.Write(chunk)
		w.Write([]byte("\n\n"))
		w.(http.Flusher).Flush()
		if !wrote {
			ev["first_ms"] = time.Since(t0).Milliseconds()
		}
		wrote = true
	}
	// Without this the page shows an empty section and no reason.
	if !wrote && r.Context().Err() == nil {
		p.stop() // stderr is complete only after Wait; reading it before races with its copy
		http.Error(w, "claude wrote no text: "+p.errs.String(), http.StatusBadGateway)
	}
}
