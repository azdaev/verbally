package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Undo, redo, and a new change that drops the redo step.
func TestUndoRedo(t *testing.T) {
	root := t.TempDir()
	f := filepath.Join(root, "f.txt")
	os.WriteFile(f, []byte("A"), 0o644)
	codeRoutes(root)
	post := func(url, body string) int {
		w := httptest.NewRecorder()
		http.DefaultServeMux.ServeHTTP(w, httptest.NewRequest("POST", url, strings.NewReader(body)))
		return w.Code
	}
	has := func(want string) {
		t.Helper()
		if b, _ := os.ReadFile(f); string(b) != want {
			t.Fatalf("file is %q, want %q", b, want)
		}
	}
	post("/api/file?path=f.txt", "B")
	post("/api/undo", "")
	has("A")
	post("/api/undo?redo=1", "")
	has("B")
	post("/api/undo", "")
	post("/api/file?path=f.txt", "C")
	if post("/api/undo?redo=1", "") != http.StatusConflict {
		t.Fatal("a new change must drop the redo step")
	}
	post("/api/undo", "")
	has("A")
	// A full path inside the app is the same file; a full path outside the app is no file.
	post("/api/file?path="+f, "F")
	has("F")
	if post("/api/file?path=/etc/hosts", "X") != http.StatusNotFound {
		t.Fatal("a file outside the app must not be written")
	}
}
