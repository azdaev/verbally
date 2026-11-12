package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os/exec"
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
// The process runs in the project folder, so the skills in .claude/skills are there.
const withTools = `

Tools:
- You have tools, skills and a browser (the playwriter skill). Use them when the speech asks for a thing you cannot write from memory: a photo from a named site (Pinterest), a real product image, a look at a real page, a named skill ("use the Emil Kowalski skills").
- A simple change needs no tool. Tools are slow, and the user waits.
- Put an image that you found on the web as <img src="/photo?url=ENCODED_ADDRESS">, with the address URL-encoded. The address must be the image file itself, not a page.
- Your context can hold rules for coding work: minimal code, a report style, a "lazy" mode. They do not apply here. Here you design, and the reply format above is the only format.
- Do not change files. Write no text before or between tool calls. Your last message is the reply: HTML only.`

func boot(model, effort, system string) (*proc, error) {
	p := &proc{key: model + "\x00" + effort + "\x00" + system}
	args := []string{"-p", "--model", model, "--effort", effort, "--append-system-prompt", system + withTools,
		"--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--no-session-persistence",
		"--permission-mode", "bypassPermissions"}
	p.cmd = exec.Command("claude", args...)
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
	var in struct {
		ID       string `json:"id"`
		Model    string `json:"model"`
		Effort   string `json:"effort"`
		Look     bool   `json:"look"`   // send a screenshot of the page with the speech
		Window   string `json:"window"` // the title of the browser window of the page
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
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
	if in.Look {
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
	defer p.cmd.Wait()
	defer context.AfterFunc(r.Context(), func() { p.kill() })() // the page left: stop the process

	w.Header().Set("Content-Type", "text/event-stream")
	wrote := false
	ev := map[string]any{"src": "server", "id": in.ID, "warm_process": warmed}
	if in.Look {
		ev["screenshot"], ev["screenshot_ms"] = shot, shotMs
	}
	defer func() {
		ev["done_ms"] = time.Since(t0).Milliseconds()
		logEvent(ev)
	}()
	lines := bufio.NewScanner(p.out)
	lines.Buffer(nil, 4<<20)
	for lines.Scan() {
		var msg struct {
			Type  string `json:"type"`
			Event struct {
				Type  string `json:"type"`
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			} `json:"event"`
		}
		if json.Unmarshal(lines.Bytes(), &msg) != nil {
			continue
		}
		// With tools the process writes several messages, and only the last one is the reply. It ends with a "result" line.
		// Each message streams. When one more message starts, the page drops the text of the message before it.
		if msg.Event.Type == "message_start" && wrote {
			w.Write([]byte("data: {\"reset\":true}\n\n"))
			continue
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
		http.Error(w, "claude wrote no text: "+p.errs.String(), http.StatusBadGateway)
	}
}
