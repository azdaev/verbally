package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Updates. Verbally never changes itself: a program that writes into the user's source files must not change without a word.
// At start it asks GitHub for the number of the newest release and tells the user. `verbally update` gets that release.
// VERBALLY_NO_UPDATE_CHECK=1 switches the question off.
const repo = "https://github.com/azdaev/verbally"

// newTag holds the tag of a newer release, when the check at start found one. The page shows it once (GET /api/setup).
var newTag atomic.Value

// latest gives the tag of the newest release. The address /releases/latest answers with a redirect to /releases/tag/v1.2.3:
// that needs no key and has no request limit, unlike the GitHub API.
func latest() (string, error) {
	c := &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := c.Head(repo + "/releases/latest")
	if err != nil {
		return "", err
	}
	res.Body.Close()
	tag := path.Base(res.Header.Get("Location"))
	if _, ok := numbers(tag); !ok {
		return "", fmt.Errorf("GitHub gave no release number (status %d)", res.StatusCode)
	}
	return tag, nil
}

// numbers reads "v0.10.2" or "v0.10.2-test" as [0 10 2].
func numbers(tag string) (n [3]int, ok bool) {
	parts := strings.Split(strings.SplitN(strings.TrimPrefix(tag, "v"), "-", 2)[0], ".")
	if !strings.HasPrefix(tag, "v") || len(parts) != 3 {
		return n, false
	}
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil {
			return n, false
		}
		n[i] = v
	}
	return n, true
}

// newer tells if release a comes after release b. A build from source ("dev") has no number: nothing is newer than it.
// With equal numbers a final release comes after its test build: v1.2.3 after v1.2.3-rc1.
func newer(a, b string) bool {
	x, okx := numbers(a)
	y, oky := numbers(b)
	if !okx || !oky {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return x[i] > y[i]
		}
	}
	return !strings.Contains(a, "-") && strings.Contains(b, "-")
}

// checkUpdate runs at start, beside the server: a slow network must not hold the start.
func checkUpdate() {
	if os.Getenv("VERBALLY_NO_UPDATE_CHECK") != "" {
		return
	}
	if tag, err := latest(); err == nil && newer(tag, version) {
		newTag.Store(tag)
		fmt.Fprintf(os.Stderr, "\nVerbally %s is out (this is %s). To get it: verbally update\n\n", tag, version)
	}
}

// update puts the newest release in the place of this program. It returns the exit code.
func update() int {
	if _, ok := numbers(version); !ok {
		fmt.Println("This Verbally is a build from source. Update it with: go install github.com/azdaev/verbally@latest")
		return 1
	}
	tag, err := latest()
	if err != nil {
		fmt.Fprintln(os.Stderr, "verbally: no answer from GitHub:", err)
		return 1
	}
	if !newer(tag, version) {
		fmt.Println("Verbally", version, "is the newest version.")
		return 0
	}
	self, err := os.Executable()
	if err == nil {
		self, err = filepath.EvalSymlinks(self)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "verbally:", err)
		return 1
	}
	// The release lists the SHA-256 of each program in SHA256SUMS (release.sh). The download must match it before it ever runs.
	name := fmt.Sprintf("verbally-%s-%s", runtime.GOOS, runtime.GOARCH)
	sums, err := download(tag, "SHA256SUMS")
	want := ""
	for _, line := range strings.Split(string(sums), "\n") {
		if f := strings.Fields(line); len(f) == 2 && f[1] == name {
			want = f[0]
		}
	}
	if err == nil && want == "" {
		err = fmt.Errorf("release %s lists no checksum for %s", tag, name)
	}
	var body []byte
	if err == nil {
		body, err = download(tag, name)
	}
	if sum := sha256.Sum256(body); err == nil && hex.EncodeToString(sum[:]) != want {
		err = fmt.Errorf("the download of %s does not match its checksum", name)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "verbally:", err)
		return 1
	}
	// The new program goes beside the old one and takes its place in one step, so a broken download leaves the old one whole.
	next := self + ".new"
	f, err := os.OpenFile(next, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err == nil {
		_, err = f.Write(body)
		if serr := f.Sync(); err == nil { // on disk before the rename, so a power cut leaves no empty program
			err = serr
		}
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}
	if err == nil { // the download must be a program that runs and names the right version
		if out, rerr := exec.Command(next, "version").Output(); rerr != nil || strings.TrimSpace(string(out)) != tag {
			err = fmt.Errorf("the download does not run as %s", tag)
		}
	}
	if err == nil {
		err = os.Rename(next, self)
	}
	if err != nil {
		os.Remove(next)
		fmt.Fprintln(os.Stderr, "verbally: the update failed, the old version stays:", err)
		return 1
	}
	fmt.Printf("Verbally %s -> %s. A Verbally that runs now keeps the old version: stop it and start it again.\n", version, tag)
	return 0
}

// download gets one file of a release. A stalled connection fails after 5 minutes, not never.
func download(tag, name string) ([]byte, error) {
	c := &http.Client{Timeout: 5 * time.Minute}
	res, err := c.Get(fmt.Sprintf("%s/releases/download/%s/%s", repo, tag, name))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release %s has no %s (status %d)", tag, name, res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 200<<20))
}
