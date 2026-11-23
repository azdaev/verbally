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
	root, _ := filepath.EvalSymlinks(t.TempDir()) // a real path, as folder() gives it (macOS has /var → /private/var)
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
	// Nor a file outside behind a link inside the app, nor git's files or packages inside it.
	outside := filepath.Join(t.TempDir(), "o.txt")
	os.WriteFile(outside, []byte("O"), 0o644)
	os.Symlink(outside, filepath.Join(root, "link.txt"))
	os.MkdirAll(filepath.Join(root, ".git"), 0o755)
	os.WriteFile(filepath.Join(root, ".git", "config"), []byte("G"), 0o644)
	for _, p := range []string{"link.txt", ".git/config"} {
		if post("/api/file?path="+p, "X") != http.StatusNotFound {
			t.Fatalf("%s must not be written", p)
		}
	}
	if b, _ := os.ReadFile(outside); string(b) != "O" {
		t.Fatal("the file behind the link changed")
	}
	// Undo after the user changed the file in an editor: the editor's text stays, and the next undo goes on.
	post("/api/file?path=f.txt", "G")
	post("/api/file?path=f.txt", "H")
	os.WriteFile(f, []byte("editor"), 0o644)
	if post("/api/undo", "") != http.StatusConflict {
		t.Fatal("undo must not write over a change from an editor")
	}
	has("editor")
	if post("/api/undo", "") != http.StatusConflict { // the step before it left G, not "editor"
		t.Fatal("an older step must not write over it either")
	}
	has("editor")
	os.WriteFile(f, []byte("A"), 0o644)

	// The picker: a version on the screen is a preview (?noundo=1), not a step to undo.
	set := func(body string) { os.WriteFile(f, []byte(body), 0o644) }
	set("base")
	post("/api/file?path=f.txt&noundo=1", "v1")
	post("/api/file?path=f.txt&noundo=1", "v2")
	if post("/api/undo", "") != http.StatusConflict {
		t.Fatal("undo must wait while a version is on the screen")
	}
	has("v2")
	// "Use this" is one undo step from the text before the picker, not from the version that was shown last.
	post("/api/file?path=f.txt&noundo=1", "v1")
	post("/api/file?path=f.txt", "v2")
	post("/api/undo", "")
	has("base")
	// "Cancel", or a page that loaded again: release puts the text from before the picker back.
	post("/api/file?path=f.txt&noundo=1", "v1")
	post("/api/release", "")
	has("base")
	if post("/api/undo?redo=1", "") != http.StatusOK { // the previews took no step and dropped none
		t.Fatal("redo must work after a cancelled choice")
	}
	has("v2")
	// Another program changed the file while it showed a version: no preview, no kept version and no release writes over it.
	post("/api/file?path=f.txt&noundo=1", "v1")
	set("editor")
	if post("/api/file?path=f.txt&noundo=1", "v3") != http.StatusConflict {
		t.Fatal("a preview must not write over a change from another program")
	}
	has("editor")
	post("/api/file?path=f.txt&noundo=1", "v1")
	set("editor 2")
	if post("/api/file?path=f.txt", "v1") != http.StatusConflict {
		t.Fatal("a kept version must not write over a change from another program")
	}
	has("editor 2")
	post("/api/file?path=f.txt&noundo=1", "v1")
	set("editor 3")
	post("/api/release", "")
	has("editor 3")

	// The browser must not keep a copy: two writes in one second have one modification time.
	w := httptest.NewRecorder()
	http.DefaultServeMux.ServeHTTP(w, httptest.NewRequest("GET", "/api/file?path=f.txt", nil))
	if w.Body.String() != "editor 3" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("GET gave %q with Cache-Control %q", w.Body.String(), w.Header().Get("Cache-Control"))
	}
}

// An app folder behind a symbolic link is named by its real path, as Vite and the model name it.
func TestFolderRealPath(t *testing.T) {
	dir := t.TempDir()
	real, _ := filepath.EvalSymlinks(dir)
	link := filepath.Join(real, "link")
	os.Mkdir(filepath.Join(real, "app"), 0o755)
	if err := os.Symlink(filepath.Join(real, "app"), link); err != nil {
		t.Skip(err)
	}
	if got, want := folder(link), filepath.Join(real, "app"); got != want {
		t.Fatalf("folder(%q) = %q, want %q", link, got, want)
	}
}

// `verbally` alone starts code mode only in a Vite + React app: a Vite app without React, or React without Vite, is not one.
func TestViteApp(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) { os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644) }
	write("package.json", `{"dependencies":{"react":"^19"}}`)
	if viteApp(dir) {
		t.Error("React without a Vite config counted as a Vite app")
	}
	write("vite.config.ts", "export default {}")
	if !viteApp(dir) {
		t.Error("vite.config.ts with React did not count")
	}
	write("package.json", `{"dependencies":{"vue":"^3","react-icons":"^5"}}`)
	if viteApp(dir) {
		t.Error("a Vue app with react-icons counted as React")
	}
}
