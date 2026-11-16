package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Code mode: VERBALLY_CODE=folder is the root of an app's source. The widget on the running app reads a file,
// the model edits it, and the widget writes it back; the app's dev server shows the change.
// Only files that exist inside the root can be read or written. Undo puts back the contents from before each write.
// Redo puts back what the last undo took away. A new change drops the redo steps, like a text editor.
// ponytail: one undo list for all files, kept in memory; git holds everything else.
type step struct{ file, body string }

var codeUndo struct {
	sync.Mutex
	list, redo []step
}

func codeRoutes(root string) {
	if root == "" {
		return
	}
	file := func(r *http.Request) (string, bool) {
		name := r.URL.Query().Get("path")
		// The model can name a file by its full path, when it found the file with its own tools (a stylesheet has no mark).
		if rel, err := filepath.Rel(root, name); filepath.IsAbs(name) && err == nil {
			name = rel
		}
		full := filepath.Join(root, filepath.Clean("/"+name)) // Clean of an absolute path drops every ".."
		info, err := os.Stat(full)
		return full, err == nil && info.Mode().IsRegular()
	}
	http.HandleFunc("GET /api/file", func(w http.ResponseWriter, r *http.Request) {
		full, ok := file(r)
		if !ok {
			http.Error(w, "no such file in the app", http.StatusNotFound)
			return
		}
		http.ServeFile(w, r, full)
	})
	http.HandleFunc("POST /api/file", func(w http.ResponseWriter, r *http.Request) {
		full, ok := file(r)
		body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		if !ok || err != nil {
			http.Error(w, "no such file in the app", http.StatusNotFound)
			return
		}
		codeUndo.Lock()
		defer codeUndo.Unlock()
		if r.URL.Query().Get("noundo") == "" { // a version shown in the picker is not a step to undo
			old, _ := os.ReadFile(full)
			codeUndo.list = append(codeUndo.list, step{full, string(old)})
			codeUndo.redo = nil
		}
		os.WriteFile(full, body, 0o644)
		logEvent(map[string]any{"src": "server", "event": "code_write", "file": r.URL.Query().Get("path"), "bytes": len(body)})
	})
	// POST /api/undo takes one step back; ?redo=1 takes one step forward. The file's current text goes to the other list.
	http.HandleFunc("POST /api/undo", func(w http.ResponseWriter, r *http.Request) {
		codeUndo.Lock()
		defer codeUndo.Unlock()
		from, to, what := &codeUndo.list, &codeUndo.redo, "undo"
		if r.URL.Query().Get("redo") != "" {
			from, to, what = to, from, "redo"
		}
		n := len(*from)
		if n == 0 {
			http.Error(w, "nothing to "+what, http.StatusConflict)
			return
		}
		last := (*from)[n-1]
		*from = (*from)[:n-1]
		now, _ := os.ReadFile(last.file)
		*to = append(*to, step{last.file, string(now)})
		os.WriteFile(last.file, []byte(last.body), 0o644)
		rel, _ := filepath.Rel(root, last.file)
		io.WriteString(w, rel)
	})
}
