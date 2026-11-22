package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Code mode: VERBALLY_CODE=folder is the root of an app's source. The widget on the running app reads a file,
// the model edits it, and the widget writes it back; the app's dev server shows the change.
// Only files that exist inside the root can be read or written. Undo puts back the contents from before each write.
// Redo puts back what the last undo took away. A new change drops the redo steps, like a text editor.
// ponytail: one undo list for all files, kept in memory; git holds everything else.
// A step also keeps the text that the change left (wrote): when the file holds something else now, an editor or another
// program changed it since, and taking the step would throw that work away.
type step struct{ file, body, wrote string }

// save writes a source file in one step: a full disk leaves the old text, and the dev server never reads half a file.
func save(full string, body []byte) error {
	info, err := os.Stat(full)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(full), ".verbally-*")
	if err != nil {
		return err
	}
	_, err = f.Write(body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(f.Name(), info.Mode().Perm())
	}
	if err == nil {
		err = os.Rename(f.Name(), full)
	}
	if err != nil {
		os.Remove(f.Name())
	}
	return err
}

// A preview is a version that the picker shows on the live app (?noundo=1). It is no step to undo.
// The server keeps the text of the file from before its first preview (base) and the text of the last one (shown):
//   - the write that keeps a version is one undo step, counted from base, whatever previews came before it;
//   - POST /api/release puts base back: for Cancel, and for a page that loaded again while it showed a version;
//   - a file that another program changed during a preview (an editor, a coding agent) is never written over.
type preview struct{ base, shown string }

var codeUndo struct {
	sync.Mutex
	list, redo []step
	held       map[string]preview // the files that show a preview now
}

func codeRoutes(root string) {
	if root == "" {
		return
	}
	codeUndo.held = map[string]preview{}
	file := func(r *http.Request) (string, bool) {
		name := r.URL.Query().Get("path")
		// The model can name a file by its full path, when it found the file with its own tools (a stylesheet has no mark).
		if rel, err := filepath.Rel(root, name); filepath.IsAbs(name) && err == nil {
			name = rel
		}
		full := filepath.Join(root, filepath.Clean("/"+name)) // Clean of an absolute path drops every ".."
		// The real path, past symbolic links, must stay inside the app (root is a real path, see folder()).
		// Hidden files and node_modules are out too: .git/config, .env and packages are no source, and a reply
		// from a model that read a hostile file must not write there.
		full, err := filepath.EvalSymlinks(full)
		rel, rerr := filepath.Rel(root, full)
		if err != nil || rerr != nil {
			return full, false
		}
		for _, part := range strings.Split(rel, string(filepath.Separator)) { // also ".." of a path outside, and "." of root
			if strings.HasPrefix(part, ".") || part == "node_modules" {
				return full, false
			}
		}
		info, err := os.Stat(full)
		return full, err == nil && info.Mode().IsRegular()
	}
	// The page turns a full path from the model into a path inside the app, so one file has one name.
	http.HandleFunc("GET /api/root", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, root) })
	http.HandleFunc("GET /api/file", func(w http.ResponseWriter, r *http.Request) {
		full, ok := file(r)
		body, err := os.ReadFile(full)
		if !ok || err != nil {
			http.Error(w, "no such file in the app", http.StatusNotFound)
			return
		}
		// no-store: a file that changed twice in one second has one modification time, and the browser then gave its old copy.
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write(body)
	})
	http.HandleFunc("POST /api/file", func(w http.ResponseWriter, r *http.Request) {
		full, ok := file(r)
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20)) // a larger body is an error, never a cut file
		if !ok || err != nil {
			http.Error(w, "no such file in the app, or the text is over 4 MB", http.StatusNotFound)
			return
		}
		codeUndo.Lock()
		defer codeUndo.Unlock()
		disk, err := os.ReadFile(full)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		old, text := string(disk), string(body)
		p, shows := codeUndo.held[full]
		if shows && old != p.shown { // another program changed the file while it showed a version: that text stays
			delete(codeUndo.held, full)
			http.Error(w, "the file changed outside Verbally, so it stays as it is", http.StatusConflict)
			return
		}
		if r.URL.Query().Get("noundo") != "" {
			if !shows {
				p.base = old
			}
			p.shown = text
			if text == p.base { // the picker shows the file as it was: no preview is left
				delete(codeUndo.held, full)
			} else {
				codeUndo.held[full] = p
			}
		} else {
			if shows {
				old = p.base
				delete(codeUndo.held, full)
			}
			if text != old {
				codeUndo.list = append(codeUndo.list, step{full, old, text})
				codeUndo.redo = nil
			}
		}
		if text != string(disk) { // an equal text is not written: the dev server would draw the page once more
			if err := save(full, body); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		logEvent(map[string]any{"src": "server", "event": "code_write", "file": r.URL.Query().Get("path"), "bytes": len(body)})
	})
	// POST /api/release ends every preview: each file gets its text from before the picker. It answers with the names of these files.
	http.HandleFunc("POST /api/release", func(w http.ResponseWriter, r *http.Request) {
		codeUndo.Lock()
		defer codeUndo.Unlock()
		var names []string
		for full, p := range codeUndo.held {
			if now, err := os.ReadFile(full); err == nil && string(now) == p.shown && save(full, []byte(p.base)) == nil {
				rel, _ := filepath.Rel(root, full)
				names = append(names, rel)
			}
		}
		clear(codeUndo.held)
		io.WriteString(w, strings.Join(names, ", "))
	})
	// POST /api/undo takes one step back; ?redo=1 takes one step forward. The file's current text goes to the other list.
	http.HandleFunc("POST /api/undo", func(w http.ResponseWriter, r *http.Request) {
		codeUndo.Lock()
		defer codeUndo.Unlock()
		from, to, what := &codeUndo.list, &codeUndo.redo, "undo"
		if r.URL.Query().Get("redo") != "" {
			from, to, what = to, from, "redo"
		}
		if len(codeUndo.held) > 0 { // a step would take the text of a version that the user did not choose
			http.Error(w, "A version is on the screen. Use it or cancel, then "+what+".", http.StatusConflict)
			return
		}
		n := len(*from)
		if n == 0 {
			http.Error(w, "nothing to "+what, http.StatusConflict)
			return
		}
		last := (*from)[n-1]
		rel, _ := filepath.Rel(root, last.file)
		now, err := os.ReadFile(last.file)
		if err != nil {
			http.Error(w, rel+": "+err.Error(), http.StatusInternalServerError)
			return
		}
		if string(now) != last.wrote { // the step is dropped, or every later ⌘Z would stop on it
			*from = (*from)[:n-1]
			http.Error(w, rel+" changed outside Verbally after this change, so it stays as it is.", http.StatusConflict)
			return
		}
		if err := save(last.file, []byte(last.body)); err != nil {
			http.Error(w, rel+": "+err.Error(), http.StatusInternalServerError)
			return
		}
		*from = (*from)[:n-1]
		*to = append(*to, step{last.file, last.wrote, last.body})
		logEvent(map[string]any{"src": "server", "event": "code_" + what, "file": rel})
		io.WriteString(w, rel)
	})
}
