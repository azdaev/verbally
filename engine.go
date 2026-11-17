package main

import (
	"fmt"
	"os"
	"os/exec"
)

// Both CLI engines accept the same request from the browser.
type chatRequest struct {
	ID     string `json:"id"`
	Model  string `json:"model"`
	Effort string `json:"effort"`
	Look   bool   `json:"look"`
	Window string `json:"window"`
	Shots  []struct {
		rect
		Label string `json:"label"`
	} `json:"shots"`
	Messages []struct {
		Content string `json:"content"`
	} `json:"messages"`
}

func defaultEngine() (string, error) {
	return chooseEngine(os.Getenv("VERBALLY_ENGINE"), os.Getenv("OPENROUTER_API_KEY") != "", exec.LookPath)
}

func chooseEngine(want string, openrouter bool, lookup func(string) (string, error)) (string, error) {
	if want != "" {
		if want == "openrouter" && openrouter {
			return want, nil
		}
		if want != "claude" && want != "codex" {
			return "", fmt.Errorf("VERBALLY_ENGINE must name an installed claude or codex CLI, or openrouter with an API key")
		}
		if _, err := lookup(want); err != nil {
			return "", fmt.Errorf("%s CLI is not installed: %w", want, err)
		}
		return want, nil
	}
	for _, name := range []string{"claude", "codex"} {
		if _, err := lookup(name); err == nil {
			return name, nil
		}
	}
	if openrouter {
		return "openrouter", nil
	}
	return "", fmt.Errorf("no engine: install and sign in to Claude Code or Codex CLI, then run verbally doctor")
}
