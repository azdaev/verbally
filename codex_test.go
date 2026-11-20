package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestChooseEngine(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		installed  []string
		key        bool
		result     string
		fail       bool
	}{
		{name: "Codex only", installed: []string{"codex"}, result: "codex"},
		{name: "keep Claude default", installed: []string{"claude", "codex"}, result: "claude"},
		{name: "explicit Codex", want: "codex", installed: []string{"claude", "codex"}, result: "codex"},
		{name: "missing requested engine", want: "codex", installed: []string{"claude"}, fail: true},
		{name: "OpenRouter fallback", key: true, result: "openrouter"},
		{name: "unknown engine", want: "other", fail: true},
		{name: "no engine", fail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lookup := func(name string) (string, error) {
				for _, available := range tc.installed {
					if name == available {
						return name, nil
					}
				}
				return "", os.ErrNotExist
			}
			got, err := chooseEngine(tc.want, tc.key, lookup)
			if got != tc.result || (err != nil) != tc.fail {
				t.Errorf("chooseEngine(%q, %v, %v) = %q, %v; want %q, error=%v", tc.want, tc.key, tc.installed, got, err, tc.result, tc.fail)
			}
		})
	}
}

func TestCodexArgsKeepWritesInVerbally(t *testing.T) {
	args := codexArgs(chatRequest{Model: "test-model", Effort: "low"}, "/tmp/reply", []string{"/tmp/shot.jpg"})
	joined := strings.Join(args, " ")
	for _, need := range []string{"--sandbox read-only", `approval_policy="never"`, "--ignore-user-config", "--model test-model", "--image=/tmp/shot.jpg", "--output-last-message /tmp/reply"} {
		if !strings.Contains(joined, need) {
			t.Errorf("codexArgs(test-model, low, shot) = %q, want %q", joined, need)
		}
	}
	if args[len(args)-1] != "-" {
		t.Errorf("codexArgs() final argument = %q, want stdin sentinel", args[len(args)-1])
	}
}

func fakeCodex(t *testing.T, mode string) (string, string) {
	t.Helper()
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	capture := filepath.Join(dir, "capture.json")
	script := "#!/bin/sh\nexec '" + strings.ReplaceAll(bin, "'", "'\\''") + "' -test.run=^TestCodexHelper$ -- \"$@\"\n"
	if err := os.WriteFile(filepath.Join(dir, "codex"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CODEX_HOME", dir) // not the config.toml of the machine
	t.Setenv("VERBALLY_HELPER", mode)
	t.Setenv("VERBALLY_TEST_CAPTURE", capture)
	old := engineDir
	engineDir = dir
	t.Cleanup(func() { engineDir = old })
	return dir, capture
}

// A subprocess doubles the CLI protocol, including its final-message file.
func TestCodexHelper(t *testing.T) {
	mode := os.Getenv("VERBALLY_HELPER")
	if mode == "" {
		return
	}
	var output string
	for i, arg := range os.Args {
		if arg == "--output-last-message" {
			output = os.Args[i+1]
		}
	}
	prompt, _ := io.ReadAll(os.Stdin)
	cwd, _ := os.Getwd()
	capture, _ := json.Marshal(map[string]string{"cwd": cwd, "prompt": string(prompt), "output": output})
	if err := os.WriteFile(os.Getenv("VERBALLY_TEST_CAPTURE"), capture, 0600); err != nil {
		os.Exit(3)
	}
	switch mode {
	case "hang":
		time.Sleep(30 * time.Second)
	case "failure":
		fmt.Println(`{"type":"turn.failed","error":{"message":"Please sign in to Codex"}}`)
		os.Exit(1)
	case "empty":
		fmt.Println(`{"type":"turn.completed"}`)
		os.Exit(0)
	default:
		fmt.Println(`{"type":"item.completed","item":{"type":"agent_message","text":"Progress must never become an edit"}}`)
		if err := os.WriteFile(output, []byte("<!--task: New title-->\n<<< src/App.jsx\nOld\n===\nNew\n>>>"), 0600); err != nil {
			os.Exit(3)
		}
		fmt.Println(`{"type":"turn.completed"}`)
	}
	os.Exit(0)
}

func TestCodexFinalReplyAndCleanup(t *testing.T) {
	dir, capture := fakeCodex(t, "success")
	req := httptest.NewRequest("POST", "/api/codex", strings.NewReader(`{"messages":[{"content":"Return edit blocks"},{"content":"Change the title"}]}`))
	res := httptest.NewRecorder()
	codexChat(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("codexChat(valid) = %d %s, want 200", res.Code, res.Body.String())
	}
	var event struct {
		Choices []struct{ Delta struct{ Content string } }
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(res.Body.String(), "data: "))), &event); err != nil {
		t.Fatal(err)
	}
	if len(event.Choices) != 1 || !strings.HasPrefix(event.Choices[0].Delta.Content, "<!--task:") {
		t.Errorf("codexChat(valid) = %#v, want final edit only", event)
	}
	data, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["cwd"] != dir || !strings.Contains(got["prompt"], "Change the title") {
		t.Errorf("Codex request = %v, want cwd %s and supplied prompt", got, dir)
	}
	if _, err := os.Stat(filepath.Dir(got["output"])); !os.IsNotExist(err) {
		t.Errorf("temporary output remains after response: %v", err)
	}
}

func TestCodexErrorsReachTheBrowser(t *testing.T) {
	for _, mode := range []string{"failure", "empty"} {
		t.Run(mode, func(t *testing.T) {
			fakeCodex(t, mode)
			res := httptest.NewRecorder()
			codexChat(res, httptest.NewRequest("POST", "/api/codex", strings.NewReader(`{"messages":[{"content":"system"},{"content":"request"}]}`)))
			if res.Code != http.StatusBadGateway {
				t.Errorf("codexChat(%s) = %d, want 502", mode, res.Code)
			}
			if mode == "failure" && !strings.Contains(res.Body.String(), "Please sign in") {
				t.Errorf("codexChat(failure) = %q, want login error", res.Body.String())
			}
		})
	}
}

func TestCodexCancelReleasesWorker(t *testing.T) {
	_, capture := fakeCodex(t, "hang")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest("POST", "/api/codex", strings.NewReader(`{"messages":[{"content":"system"},{"content":"request"}]}`)).WithContext(ctx)
	done := make(chan struct{})
	go func() { defer close(done); codexChat(httptest.NewRecorder(), req) }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Stat(capture); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Codex helper does not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled Codex request keeps running")
	}
	if len(slots) != 0 {
		t.Errorf("workers after cancel = %d, want 0", len(slots))
	}
}

func TestCodexWarmupDoesNotLaunchCLI(t *testing.T) {
	_, capture := fakeCodex(t, "success")
	res := httptest.NewRecorder()
	codexChat(res, httptest.NewRequest("POST", "/api/codex", strings.NewReader(`{"messages":[{"content":"system"}]}`)))
	if res.Code != http.StatusNoContent {
		t.Errorf("codexChat(warmup) = %d, want 204", res.Code)
	}
	if _, err := os.Stat(capture); !os.IsNotExist(err) {
		t.Errorf("warmup starts a CLI process: %v", err)
	}
}

func TestCodexEventsReportFailuresAndSkipOddLines(t *testing.T) {
	long := `{"type":"item.completed","item":{"aggregated_output":"` + strings.Repeat("x", (4<<20)+1) + `"}}` + "\n"
	for _, input := range []string{`{"type":"turn.failed","error":{"message":"quota"}}`, `{"type":"error","message":"login required"}`,
		"not json\n" + long + `{"type":"turn.failed","error":{"message":"quota"}}`} {
		if err := codexEvents(strings.NewReader(input)); err == nil {
			t.Errorf("codexEvents(%q...) = nil, want error", input[:min(20, len(input))])
		}
	}
	for _, input := range []string{"{\"type\":\"error\",\"message\":\"retrying\"}\n{\"type\":\"turn.completed\"}\n", "not json\n" + long + `{"type":"turn.completed"}`} {
		if err := codexEvents(strings.NewReader(input)); err != nil {
			t.Errorf("codexEvents(%q...) = %v, want nil", input[:min(20, len(input))], err)
		}
	}
}

func TestCodexDefaultModelComesFromConfig(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CODEX_HOME", dir)
	os.WriteFile(filepath.Join(dir, "config.toml"), []byte("model_reasoning_effort = \"xhigh\"\nmodel = \"gpt-test\" # mine\n[profiles.fast]\nmodel = \"other\"\n"), 0600)
	if got := strings.Join(codexArgs(chatRequest{}, "/tmp/reply", nil), " "); !strings.Contains(got, "--model gpt-test ") {
		t.Errorf("codexArgs(no model) = %q, want --model gpt-test from config.toml", got)
	}
	if got := strings.Join(codexArgs(chatRequest{Model: "chosen"}, "/tmp/reply", nil), " "); !strings.Contains(got, "--model chosen ") {
		t.Errorf("codexArgs(chosen) = %q, want the chosen model", got)
	}
	os.WriteFile(filepath.Join(dir, "config.toml"), []byte("[profiles.fast]\nmodel = \"other\"\n"), 0600)
	if got := strings.Join(codexArgs(chatRequest{}, "/tmp/reply", nil), " "); strings.Contains(got, "--model") {
		t.Errorf("codexArgs(model only in a table) = %q, want no --model", got)
	}
}

func TestDiagnosticTailIsBounded(t *testing.T) {
	var b diagnosticTail
	b.Write([]byte(strings.Repeat("a", 5000)))
	b.Write([]byte("end"))
	if len(b.data) != 4096 || !reflect.DeepEqual(b.data[len(b.data)-3:], []byte("end")) {
		t.Errorf("diagnostic tail: length=%d, want 4096 and suffix end", len(b.data))
	}
}
