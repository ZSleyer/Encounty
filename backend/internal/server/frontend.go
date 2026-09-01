// frontend.go serves the built frontend assets and the SPA index fallback.

package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/zsleyer/encounty/backend/internal/pathsafe"
)

// serveFrontend serves frontend assets from the configured directory.
// Non-file paths fall back to index.html for SPA client-side routing.
// The fallback injects a <base href="/"> tag so that relative asset paths
// (produced by Vite's base: "./") resolve correctly for nested routes like
// /overlay/{id} when loaded in OBS.
func (s *Server) serveFrontend(w http.ResponseWriter, r *http.Request) {
	// Skip API, WebSocket, and Swagger routes (they have their own handlers,
	// but guard here as well for safety).
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" || strings.HasPrefix(r.URL.Path, "/swagger/") {
		http.NotFound(w, r)
		return
	}

	// Try to serve the exact file from the frontend directory. Contain the
	// request path so "../" sequences cannot escape frontendDir.
	if filePath, err := pathsafe.Join(s.frontendDir, r.URL.Path); err == nil {
		if info, statErr := os.Stat(filePath); statErr == nil && !info.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}
	}

	// SPA fallback: read index.html once and inject <base href="/"> so that
	// relative asset URLs (./assets/...) resolve from the root, not from
	// the current path (which breaks for /overlay/{id} in OBS).
	s.serveIndexWithBase(w, r)
}

// indexHTML caches the patched index.html content to avoid re-reading on
// every SPA fallback request. Populated lazily by serveIndexWithBase.
var indexHTML atomic.Value

// serveIndexWithBase reads index.html from the frontend directory, injects a
// <base href="/"> tag after <head>, and serves it with the correct content type.
func (s *Server) serveIndexWithBase(w http.ResponseWriter, _ *http.Request) {
	if cached, ok := indexHTML.Load().([]byte); ok && len(cached) > 0 {
		w.Header().Set(headerContentType, "text/html; charset=utf-8")
		_, _ = w.Write(cached)
		return
	}

	indexPath := filepath.Join(s.frontendDir, "index.html")
	raw, err := os.ReadFile(indexPath)
	if err != nil {
		http.Error(w, "index.html not found", http.StatusNotFound)
		return
	}

	// Inject <base href="/"> right after the opening <head> tag so all
	// relative URLs resolve from the root.
	patched := strings.Replace(string(raw), "<head>", `<head><base href="/">`, 1)
	data := []byte(patched)
	indexHTML.Store(data)

	w.Header().Set(headerContentType, "text/html; charset=utf-8")
	_, _ = w.Write(data)
}
