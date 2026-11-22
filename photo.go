package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// photo answers /photo?q=keywords with a real photo from Wikimedia Commons.
// The first request downloads the photo into photos/. Later requests read the file.
// So a page does not break when the source is slow or changes its search results, and equal keywords always give the same photo.
// ponytail: the first search hit. Use a photo API with a key when the picks are poor.
var photoMu sync.Mutex

var photoClient = &http.Client{Timeout: 20 * time.Second}

func photo(w http.ResponseWriter, r *http.Request) {
	// /photo?url=address keeps a copy of one image that the model found on the web, so the page does not depend on that site.
	if address := r.URL.Query().Get("url"); strings.HasPrefix(address, "https://") {
		sum := sha1.Sum([]byte(address))
		file := filepath.Join("photos", hex.EncodeToString(sum[:8])+".img")
		if _, err := os.Stat(file); err != nil {
			img, err := get(r, address)
			if err != nil || !strings.HasPrefix(http.DetectContentType(img), "image/") {
				logEvent(map[string]any{"src": "server", "event": "photo_failed", "url": address})
				http.Error(w, "no image at this address", http.StatusBadGateway)
				return
			}
			if err := keep(file, img); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			logEvent(map[string]any{"src": "server", "event": "photo", "url": address, "bytes": len(img)})
		}
		serve(w, r, file)
		return
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if q == "" {
		http.Error(w, "need q", http.StatusBadRequest)
		return
	}
	sum := sha1.Sum([]byte(q))
	file := filepath.Join("photos", hex.EncodeToString(sum[:8])+".jpg")
	if _, err := os.Stat(file); err != nil {
		// A long query often finds nothing. Drop the last word and search again, down to two words.
		// Wikimedia refuses many searches at once (status 429), and a picker asks for ten photos together. So one search runs at a time.
		photoMu.Lock()
		defer photoMu.Unlock()
		if _, err := os.Stat(file); err == nil { // another request for the same words got it meanwhile
			serve(w, r, file)
			return
		}
		words := strings.Fields(q)
		err := fetchPhoto(r, q, file)
		for len(words) > 2 && err == os.ErrNotExist {
			words = words[:len(words)-1]
			err = fetchPhoto(r, strings.Join(words, " "), file)
		}
		if err != nil {
			logEvent(map[string]any{"src": "server", "event": "photo_failed", "q": q, "error": err.Error()})
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
	}
	serve(w, r, file)
}

// serve sends a kept photo. Its address never changes its content, so the browser may keep it for a year.
func serve(w http.ResponseWriter, r *http.Request, file string) {
	w.Header().Set("Cache-Control", "max-age=31536000, immutable")
	http.ServeFile(w, r, file)
}

func fetchPhoto(r *http.Request, q, file string) error {
	started := time.Now()
	search := "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=1280&format=json&gsrsearch=" +
		url.QueryEscape(q+" filetype:bitmap")
	var found struct {
		Query struct {
			Pages map[string]struct {
				ImageInfo []struct {
					ThumbURL string `json:"thumburl"`
				} `json:"imageinfo"`
			} `json:"pages"`
		} `json:"query"`
	}
	body, err := get(r, search)
	if err != nil {
		return err
	}
	json.Unmarshal(body, &found)
	for _, p := range found.Query.Pages {
		if len(p.ImageInfo) == 0 {
			continue
		}
		img, err := get(r, p.ImageInfo[0].ThumbURL)
		if err != nil {
			return err
		}
		logEvent(map[string]any{"src": "server", "event": "photo", "q": q, "bytes": len(img), "ms": time.Since(started).Milliseconds()})
		return keep(file, img)
	}
	return os.ErrNotExist
}

// keep writes a photo under a spare name and then renames it: a request that finds the file finds it whole,
// and the browser never keeps half a photo for a year.
func keep(file string, img []byte) error {
	os.MkdirAll("photos", 0o700)
	f, err := os.CreateTemp("photos", "part-*")
	if err != nil {
		return err
	}
	_, err = f.Write(img)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(f.Name(), file)
	}
	if err != nil {
		os.Remove(f.Name())
	}
	return err
}

// get downloads one address. Wikimedia sometimes refuses a burst of requests, so a refusal gets one more try after a second.
func get(r *http.Request, address string) ([]byte, error) {
	for try := 0; ; try++ {
		req, err := http.NewRequestWithContext(r.Context(), "GET", address, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "verbally-prototype/0.1 (local design tool)") // Wikimedia asks for a client name
		res, err := photoClient.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(res.Body, 20<<20))
		res.Body.Close()
		if res.StatusCode == 200 {
			return body, err
		}
		if try == 3 || res.StatusCode < 429 {
			return nil, fmt.Errorf("GET %s: status %d", address, res.StatusCode)
		}
		time.Sleep(time.Duration(try+1) * time.Second)
	}
}
