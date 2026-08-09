// sprites_test.go covers the sprite proxy: its allowlist, the disk cache and
// the negative cache for sprites that do not exist upstream.
package games

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// spriteUpstream stands in for GitHub. It counts requests so a test can assert
// that a second call was served from the cache, and serves one known sprite.
type spriteUpstream struct {
	server *httptest.Server
	hits   atomic.Int32
	body   []byte
}

// newSpriteUpstream starts a fake sprite host and points the proxy's allowlist
// and HTTP client at it for the duration of the test.
func newSpriteUpstream(t *testing.T, body []byte) *spriteUpstream {
	t.Helper()
	up := &spriteUpstream{body: body}
	up.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		up.hits.Add(1)
		if strings.Contains(r.URL.Path, "missing") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if strings.Contains(r.URL.Path, "huge") {
			_, _ = w.Write(make([]byte, spriteMaxBytes+10))
			return
		}
		if strings.Contains(r.URL.Path, "redirect") {
			// Off the allowlisted prefix, the same move an upstream host would
			// make to steer the proxy somewhere it was never allowed to go.
			http.Redirect(w, r, "/elsewhere/evil.png", http.StatusFound)
			return
		}
		_, _ = w.Write(up.body)
	}))
	t.Cleanup(up.server.Close)

	prevList, prevClient := spriteAllowlist, spriteClient
	spriteAllowlist = []string{up.server.URL + "/sprites/"}
	client := up.server.Client()
	// The redirect policy is part of what is under test, so the stand-in client
	// keeps it rather than silently following every hop.
	client.CheckRedirect = checkSpriteRedirect
	spriteClient = client
	t.Cleanup(func() { spriteAllowlist, spriteClient = prevList, prevClient })
	return up
}

// url builds a proxy request path for one upstream sprite file.
func (u *spriteUpstream) url(name string) string {
	return "/api/sprite?url=" + url.QueryEscape(u.server.URL+"/sprites/"+name)
}

// newSpriteMux registers the routes against a fresh config directory and
// returns both the mux and that directory.
func newSpriteMux(t *testing.T) (*http.ServeMux, string) {
	t.Helper()
	dir := t.TempDir()
	mux := newTestMux(t, &mockDeps{
		games:   &mockGamesStore{},
		pokedex: &mockPokedexStore{},
		cfgDir:  dir,
	})
	return mux, dir
}

// get issues one proxy request and returns the recorder.
func get(mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestSpriteProxyRejectsForeignHosts(t *testing.T) {
	newSpriteUpstream(t, []byte("png"))
	mux, _ := newSpriteMux(t)

	for name, target := range map[string]string{
		"missing url":     "",
		"foreign host":    "https://example.com/sprites/1.png",
		"internal host":   "http://127.0.0.1:9999/sprites/1.png",
		"file scheme":     "file:///etc/passwd",
		"non image":       "https://raw.githubusercontent.com/PokeAPI/sprites/master/README.md",
		"allowed prefix?": "https://raw.githubusercontent.com/evil/PokeAPI/sprites/1.png",
	} {
		rec := get(mux, "/api/sprite?url="+url.QueryEscape(target))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, rec.Code)
		}
	}
}

func TestSpriteProxyCachesOnDisk(t *testing.T) {
	up := newSpriteUpstream(t, []byte("fake-png-bytes"))
	mux, dir := newSpriteMux(t)

	rec := get(mux, up.url("25.png"))
	if rec.Code != http.StatusOK {
		t.Fatalf(fmtStatusWant200, rec.Code)
	}
	if got := rec.Body.String(); got != "fake-png-bytes" {
		t.Errorf("body = %q, want the upstream bytes", got)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != spriteCacheControl {
		t.Errorf("Cache-Control = %q, want %q", cc, spriteCacheControl)
	}

	entries, err := os.ReadDir(filepath.Join(dir, spriteCacheDirName))
	if err != nil {
		t.Fatalf("cache dir not created: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("cache holds %d files, want 1", len(entries))
	}

	// Second call must not reach upstream again.
	if rec = get(mux, up.url("25.png")); rec.Code != http.StatusOK {
		t.Fatalf("second call: status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "fake-png-bytes" {
		t.Error("second call did not serve the cached bytes")
	}
	if hits := up.hits.Load(); hits != 1 {
		t.Errorf("upstream hits = %d, want 1", hits)
	}
}

func TestSpriteProxyRemembersMisses(t *testing.T) {
	up := newSpriteUpstream(t, nil)
	mux, dir := newSpriteMux(t)

	for i := range 2 {
		if rec := get(mux, up.url("missing.png")); rec.Code != http.StatusNotFound {
			t.Fatalf("call %d: status = %d, want 404", i, rec.Code)
		}
	}
	if hits := up.hits.Load(); hits != 1 {
		t.Errorf("upstream hits = %d, want 1: the miss was not remembered", hits)
	}

	// An expired negative entry has to let the next call try again.
	entries, err := os.ReadDir(filepath.Join(dir, spriteCacheDirName))
	if err != nil || len(entries) != 1 {
		t.Fatalf("negative entry not written: %v, %d files", err, len(entries))
	}
	stale := time.Now().Add(-spriteMissTTL - time.Minute)
	missPath := filepath.Join(dir, spriteCacheDirName, entries[0].Name())
	if !strings.HasSuffix(missPath, spriteMissSuffix) {
		t.Fatalf("cached file %q is not a negative entry", entries[0].Name())
	}
	if err := os.Chtimes(missPath, stale, stale); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	if rec := get(mux, up.url("missing.png")); rec.Code != http.StatusNotFound {
		t.Fatalf("after expiry: status = %d, want 404", rec.Code)
	}
	if hits := up.hits.Load(); hits != 2 {
		t.Errorf("upstream hits = %d, want 2: the expired entry was not retried", hits)
	}
}

func TestSpriteProxyRejectsOversizedResponses(t *testing.T) {
	up := newSpriteUpstream(t, nil)
	mux, dir := newSpriteMux(t)

	if rec := get(mux, up.url("huge.png")); rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
	if _, err := os.ReadDir(filepath.Join(dir, spriteCacheDirName)); err == nil {
		t.Error("an oversized response must not be cached")
	}
}

// The allowlist is checked on the URL that arrives. Following a redirect blind
// would hand the choice of what actually gets fetched to the upstream host,
// which is the whole point of not being an open forward proxy.
func TestSpriteProxyRejectsRedirectsOffTheAllowlist(t *testing.T) {
	up := newSpriteUpstream(t, []byte("sprite"))
	mux, dir := newSpriteMux(t)

	if rec := get(mux, up.url("redirect.png")); rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
	if _, err := os.ReadDir(filepath.Join(dir, spriteCacheDirName)); err == nil {
		t.Error("a rejected redirect must not be cached")
	}
}
