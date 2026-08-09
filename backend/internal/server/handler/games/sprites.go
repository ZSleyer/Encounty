// sprites.go proxies the external Pokemon sprite hosts through an on-disk
// cache. The renderer builds well over a thousand sprite URLs when the Pokedex
// opens; served straight from GitHub those are a thousand network round trips
// per session and nothing at all without a connection. Routing them through
// here fetches each sprite once, ever.
package games

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/httputil"
)

const (
	// spriteCacheControl lets the renderer keep a sprite indefinitely. Every
	// upstream URL names exactly one image and is never rewritten, so a cached
	// copy cannot go stale.
	spriteCacheControl = "public, max-age=31536000, immutable"

	// spriteMaxBytes caps a single upstream response. The largest sprite in use
	// is an animated gif well under one megabyte.
	spriteMaxBytes = 2 << 20

	// spriteFetchTimeout bounds one upstream request.
	spriteFetchTimeout = 10 * time.Second

	// spriteMissTTL is how long a missing sprite stays remembered. Plenty of
	// form sprites simply do not exist upstream, and without a negative entry
	// every scroll past their slot would ask GitHub again.
	spriteMissTTL = time.Hour

	// spriteCacheDirName is the cache folder inside the config directory.
	spriteCacheDirName = "sprite-cache"

	// spriteMissSuffix marks a negative cache entry.
	spriteMissSuffix = ".miss"

	// spriteMaxConcurrentFetches bounds how many upstream requests run at once.
	// Opening the Pokedex asks for a thousand sprites in one go; unbounded that
	// is a thousand parallel connections to one host and a rate limit.
	spriteMaxConcurrentFetches = 8
)

// errSpriteMissing reports that upstream has no such sprite. Callers turn it
// into a 404 rather than a 502: a missing form sprite is expected, not a fault.
var errSpriteMissing = errors.New("sprite not found upstream")

// spriteAllowlist holds the URL prefixes this proxy is willing to fetch. It is
// the trust boundary of the endpoint: without it /api/sprite would be an open
// forward proxy into whatever the host machine can reach. Declared as a var so
// tests can point it at a local server.
var spriteAllowlist = []string{
	"https://raw.githubusercontent.com/PokeAPI/sprites/",
	"https://raw.githubusercontent.com/msikma/pokesprite/",
	"https://raw.githubusercontent.com/kwsch/PKHeX/",
	"https://play.pokemonshowdown.com/sprites/",
}

// spriteClient performs the upstream requests. A var so tests can replace it.
var spriteClient = &http.Client{Timeout: spriteFetchTimeout}

// spriteFetchSlots implements the concurrency bound described by
// spriteMaxConcurrentFetches.
var spriteFetchSlots = make(chan struct{}, spriteMaxConcurrentFetches)

// spriteContentTypes maps the file extensions the proxy serves to their MIME
// type. An extension outside this set is rejected, which is a second belt
// beside the allowlist: the endpoint can only ever relay images.
var spriteContentTypes = map[string]string{
	".png":  "image/png",
	".gif":  "image/gif",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".svg":  "image/svg+xml",
}

// spriteContentType validates an upstream URL against the allowlist and the
// known image extensions, returning the MIME type to serve it as.
func spriteContentType(raw string) (string, error) {
	if raw == "" {
		return "", errors.New("missing url parameter")
	}
	allowed := false
	for _, prefix := range spriteAllowlist {
		if strings.HasPrefix(raw, prefix) {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", errors.New("url is not an allowed sprite host")
	}
	// Parsing after the prefix check keeps a malformed URL from ever reaching
	// the network, and drops any query string before the extension is read.
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("url is not parseable")
	}
	ctype, ok := spriteContentTypes[strings.ToLower(path.Ext(parsed.Path))]
	if !ok {
		return "", errors.New("url does not name an image")
	}
	return ctype, nil
}

// spriteCachePath returns the cache file for an upstream URL. The name is the
// hash of the full URL, so two sprites that differ only in their query string
// or host cannot collide.
func (h *handler) spriteCachePath(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return filepath.Join(h.deps.ConfigDir(), spriteCacheDirName, hex.EncodeToString(sum[:]))
}

// readSpriteCache returns the cached bytes for a sprite. It reports
// errSpriteMissing when a fresh negative entry says upstream has none, and a
// nil slice with a nil error when there is simply no entry yet.
func readSpriteCache(cachePath string) ([]byte, error) {
	if data, err := os.ReadFile(cachePath); err == nil {
		return data, nil
	}
	info, err := os.Stat(cachePath + spriteMissSuffix)
	if err != nil {
		return nil, nil
	}
	if time.Since(info.ModTime()) < spriteMissTTL {
		return nil, errSpriteMissing
	}
	// Expired: drop it so the next miss records a fresh timestamp.
	_ = os.Remove(cachePath + spriteMissSuffix)
	return nil, nil
}

// writeSpriteCache stores data at cachePath. The write goes through a temporary
// file in the same directory so an interrupted run cannot leave a truncated
// sprite behind that would then be served forever.
func writeSpriteCache(cachePath string, data []byte) error {
	dir := filepath.Dir(cachePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(cachePath)+".tmp*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		_ = os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, cachePath); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}

// fetchSprite retrieves one sprite from upstream, subject to the concurrency
// bound and the size cap. A 404 comes back as errSpriteMissing.
func fetchSprite(raw string) ([]byte, error) {
	spriteFetchSlots <- struct{}{}
	defer func() { <-spriteFetchSlots }()

	res, err := spriteClient.Get(raw)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusNotFound {
		return nil, errSpriteMissing
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", res.StatusCode, raw)
	}
	// One byte over the cap is read on purpose: it separates "exactly at the
	// limit" from "truncated", so an oversized response is rejected instead of
	// being cached half-complete.
	data, err := io.ReadAll(io.LimitReader(res.Body, spriteMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > spriteMaxBytes {
		return nil, fmt.Errorf("sprite larger than %d bytes: %s", spriteMaxBytes, raw)
	}
	return data, nil
}

// spriteBytes returns a sprite from the cache, fetching and storing it on the
// first miss.
//
// ponytail: the cache never evicts. The whole sprite corpus is a few tens of
// megabytes and it only ever grows by what the hunter actually looks at. Add an
// LRU sweep if that stops being true.
func (h *handler) spriteBytes(raw string) ([]byte, error) {
	cachePath := h.spriteCachePath(raw)
	cached, err := readSpriteCache(cachePath)
	if err != nil || cached != nil {
		return cached, err
	}

	data, err := fetchSprite(raw)
	if errors.Is(err, errSpriteMissing) {
		if writeErr := writeSpriteCache(cachePath+spriteMissSuffix, nil); writeErr != nil {
			slog.Debug("Sprite negative cache write failed", "error", writeErr)
		}
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	if writeErr := writeSpriteCache(cachePath, data); writeErr != nil {
		// The sprite itself is fine, it just will not be cached. Serving it is
		// still the right answer.
		slog.Warn("Sprite cache write failed", "error", writeErr)
	}
	return data, nil
}

// handleGetSprite serves an external Pokemon sprite from the on-disk cache,
// fetching it from its upstream host on the first miss.
// GET /api/sprite?url=<upstream sprite url>
//
// @Summary      Get a cached external sprite
// @Description  Proxies an allowlisted sprite host through a persistent disk cache
// @Tags         pokedex
// @Produce      image/png
// @Param        url query string true "Upstream sprite URL"
// @Success      200 {file} file
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      502 {object} httputil.ErrResp
// @Router       /sprite [get]
func (h *handler) handleGetSprite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	raw := r.URL.Query().Get("url")
	ctype, err := spriteContentType(raw)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}

	data, err := h.spriteBytes(raw)
	switch {
	case errors.Is(err, errSpriteMissing):
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errSpriteMissing.Error()})
		return
	case err != nil:
		slog.Warn("Sprite proxy fetch failed", "url", raw, "error", err)
		httputil.WriteJSON(w, http.StatusBadGateway, httputil.ErrResp{Error: err.Error()})
		return
	}

	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", spriteCacheControl)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
