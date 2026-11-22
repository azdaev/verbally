package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const codexInstructions = `You are the design engine inside Verbally. Follow the reply format below exactly.
Read files when needed, but do not write files or run commands that change the project.
Verbally applies your reply and owns preview, cancellation, and undo.
Return only the requested HTML or edit blocks in your final message. Do not add Markdown fences or explanations.
Your context can hold rules for coding work: minimal code, a report style, a "lazy" mode. They do not apply here. Here you design, and the reply format below is the only format.
`

// codexArgs uses the CLI's saved login, with no user plugins or MCP servers.
// Codex can read the app, but only Verbally writes edits and records undo steps.
func codexArgs(in chatRequest, output string, images []string) []string {
	args := []string{"exec", "--json", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
		"--sandbox", "read-only", "-c", `approval_policy="never"`, "--color", "never", "--output-last-message", output}
	model := in.Model
	if model == "" {
		model = codexConfigModel()
	}
	if model != "" {
		args = append(args, "--model", model)
	}
	if in.Effort != "" {
		args = append(args, "-c", "model_reasoning_effort="+strconv.Quote(in.Effort))
	}
	for _, image := range images {
		args = append(args, "--image="+image) // --image takes several values: the = form keeps "-" the prompt
	}
	return append(args, "-")
}

// codexConfigModel reads the top-level `model = "..."` of the user's config.toml.
// --ignore-user-config drops the whole file; the model is the one setting a user expects "the default" to keep.
func codexConfigModel() string {
	home := os.Getenv("CODEX_HOME")
	if home == "" {
		dir, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		home = filepath.Join(dir, ".codex")
	}
	data, err := os.ReadFile(filepath.Join(home, "config.toml"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") {
			return "" // the top-level keys end at the first table
		}
		key, value, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(key) == "model" {
			value = strings.TrimSpace(strings.SplitN(value, "#", 2)[0])
			if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' { // a TOML literal string: 'gpt-5-codex'
				return value[1 : len(value)-1]
			}
			if model, err := strconv.Unquote(value); err == nil {
				return model
			}
		}
	}
	return ""
}

// Keep only a bounded diagnostic tail. Do not buffer entire CLI transcripts.
type diagnosticTail struct{ data []byte }

func (b *diagnosticTail) Write(p []byte) (int, error) {
	n := len(p)
	const limit = 4096
	if len(p) >= limit {
		b.data = append(b.data[:0], p[len(p)-limit:]...)
	} else {
		b.data = append(b.data, p...)
		if len(b.data) > limit {
			b.data = b.data[len(b.data)-limit:]
		}
	}
	return n, nil
}

// Only the CLI's final-message file becomes an edit. Progress and tool messages never reach the page.
// A line that is not an event, or too long to read (a tool's whole output), is skipped:
// failure comes from turn.failed, error events and the exit code, not from one odd line.
func codexEvents(r io.Reader) error {
	read := bufio.NewReaderSize(r, 64<<10)
	var failure, lastError string
	for {
		line, err := read.ReadSlice('\n')
		if err == bufio.ErrBufferFull { // the type of a long event is not needed: the rest of the line goes
			for err == bufio.ErrBufferFull {
				_, err = read.ReadSlice('\n')
			}
			line = nil
		}
		if err != nil && err != io.EOF {
			return fmt.Errorf("read Codex stream: %w", err)
		}
		var event struct {
			Type    string `json:"type"`
			Message string `json:"message"`
			Error   struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(line, &event) != nil {
			event.Type = ""
		}
		if event.Type == "error" {
			lastError = event.Message
		}
		if event.Type == "turn.completed" {
			lastError = ""
		}
		if event.Type == "turn.failed" {
			failure = event.Error.Message
			if failure == "" {
				failure = "Codex turn failed"
			}
		}
		if err == io.EOF {
			break
		}
	}
	if failure != "" {
		return fmt.Errorf("%s", failure)
	}
	if lastError != "" {
		return fmt.Errorf("%s", lastError)
	}
	return nil
}

func codexChat(w http.ResponseWriter, r *http.Request) {
	var in chatRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || len(in.Messages) == 0 || len(in.Messages) > 2 {
		http.Error(w, "need a system message and at most one user message", http.StatusBadRequest)
		return
	}
	// codex exec has no warm-stdin protocol. Do not launch it for a warm-up request.
	if len(in.Messages) == 1 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	started := time.Now()
	select {
	case slots <- struct{}{}:
	case <-r.Context().Done():
		return
	}
	defer func() { <-slots }()
	dir, err := os.MkdirTemp("", "verbally-codex-")
	if err != nil {
		http.Error(w, "prepare Codex output: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(dir) // Images and the final reply are transient.
	prompt := codexInstructions + "\nReply instructions:\n" + in.Messages[0].Content + "\n\nRequest:\n" + in.Messages[1].Content
	var images []string
	attach := func(encoded, label string) {
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return
		} // Match Claude's text-only fallback when a screenshot fails.
		path := filepath.Join(dir, fmt.Sprintf("shot-%d.jpg", len(images)+1))
		if err := os.WriteFile(path, data, 0600); err != nil {
			return
		}
		images = append(images, path)
		prompt += fmt.Sprintf("\nAttached image %d: %s", len(images), label)
	}
	if len(in.Shots) > 0 {
		for _, shot := range in.Shots[:min(len(in.Shots), 5)] {
			if image, err := shotRect(shot.rect); err == nil {
				attach(image, shot.Label)
			}
		}
	} else if in.Look {
		if image, err := screenshot(in.Window); err == nil {
			attach(image, "The current page")
		}
	}
	output := filepath.Join(dir, "reply.txt")
	cmd := exec.Command("codex", codexArgs(in, output, images)...)
	cmd.Dir = engineDir
	cmd.Stdin = strings.NewReader(prompt)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var stderr diagnosticTail
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "prepare Codex stream: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := cmd.Start(); err != nil {
		http.Error(w, "start Codex CLI: "+err.Error(), http.StatusBadGateway)
		return
	}
	kill := func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) } // May already have exited.
	stop := context.AfterFunc(r.Context(), kill)
	defer stop()
	streamErr := codexEvents(stdout)
	if streamErr != nil {
		kill()
	}
	runErr := cmd.Wait()
	if r.Context().Err() != nil {
		return
	}
	if streamErr != nil || runErr != nil {
		reason := streamErr
		if reason == nil {
			reason = fmt.Errorf("%v: %s", runErr, strings.TrimSpace(string(stderr.data)))
		}
		http.Error(w, "Codex CLI: "+reason.Error(), http.StatusBadGateway)
		return
	}
	// The reply is subject to the same 4 MiB bound as the existing engine stream.
	file, err := os.Open(output)
	if err != nil {
		http.Error(w, "Codex returned no final message", http.StatusBadGateway)
		return
	}
	defer file.Close()
	reply, err := io.ReadAll(io.LimitReader(file, (4<<20)+1))
	if err != nil || len(reply) > 4<<20 || len(strings.TrimSpace(string(reply))) == 0 {
		http.Error(w, "Codex returned an empty or oversized final message", http.StatusBadGateway)
		return
	}
	chunk, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": string(reply)}}}})
	if err != nil {
		http.Error(w, "encode Codex reply: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprintf(w, "data: %s\n\n", chunk)
	logEvent(map[string]any{"src": "server", "engine": "codex", "id": in.ID, "done_ms": time.Since(started).Milliseconds(), "screenshots": len(images)})
}
