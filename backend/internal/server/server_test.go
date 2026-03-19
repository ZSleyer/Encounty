package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"

	"github.com/zsleyer/encounty/backend/internal/hotkeys"
)

const (
	srvFmtStatus  = "status = %d, want %d"
	fileIndexHTML  = "index.html"
)

// --- CORS Middleware Tests ---

// TestCorsMiddlewareHeaders verifies that CORS headers are added to regular
// requests and the inner handler is invoked.
func TestCorsMiddlewareHeaders(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := corsMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(srvFmtStatus, w.Code, http.StatusOK)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Allow-Origin = %q, want %q", got, "*")
	}
	if got := w.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("Allow-Methods header is empty")
	}
	if got := w.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Error("Allow-Headers header is empty")
	}
}

// TestCorsMiddlewarePreflight verifies that OPTIONS requests receive a 204
// and the inner handler is NOT invoked.
func TestCorsMiddlewarePreflight(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	handler := corsMiddleware(inner)

	req := httptest.NewRequest(http.MethodOptions, "/api/pokemon", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf(srvFmtStatus, w.Code, http.StatusNoContent)
	}
	if called {
		t.Error("inner handler should not be called for OPTIONS preflight")
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Allow-Origin = %q, want %q", got, "*")
	}
}

// --- SPA Handler Tests ---

// TestSPAHandlerServesStaticFile verifies that the SPA handler serves a real
// file from the embedded FS when the path matches.
func TestSPAHandlerServesStaticFile(t *testing.T) {
	fsys := fstest.MapFS{
		fileIndexHTML:        {Data: []byte("<html>SPA</html>")},
		"assets/main.js":    {Data: []byte("console.log('app')")},
		"assets/style.css":  {Data: []byte("body{}")},
	}

	handler := spaHandler(fsys)

	req := httptest.NewRequest(http.MethodGet, "/assets/main.js", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(srvFmtStatus, w.Code, http.StatusOK)
	}
	if got := w.Body.String(); got != "console.log('app')" {
		t.Errorf("body = %q, want JS content", got)
	}
}

// TestSPAHandlerFallbackToIndex verifies that unknown paths return
// index.html for client-side routing.
func TestSPAHandlerFallbackToIndex(t *testing.T) {
	indexContent := "<html><body>Encounty SPA</body></html>"
	fsys := fstest.MapFS{
		fileIndexHTML: {Data: []byte(indexContent)},
	}

	handler := spaHandler(fsys)

	paths := []string{"/overlay", "/settings", "/nonexistent/path"}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("path %q: status = %d, want %d", p, w.Code, http.StatusOK)
		}
		if got := w.Body.String(); got != indexContent {
			t.Errorf("path %q: body = %q, want index.html content", p, got)
		}
		if ct := w.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
			t.Errorf("path %q: Content-Type = %q, want text/html", p, ct)
		}
	}
}

// TestSPAHandlerDirectoryFallback verifies that directory paths fall back to
// index.html instead of triggering FileServer's directory listing or redirect.
func TestSPAHandlerDirectoryFallback(t *testing.T) {
	indexContent := "<html>app</html>"
	fsys := fstest.MapFS{
		fileIndexHTML:     {Data: []byte(indexContent)},
		"assets/main.js": {Data: []byte("js")},
	}

	handler := spaHandler(fsys)

	// Requesting "/assets/" (a directory) should fall back to index.html.
	req := httptest.NewRequest(http.MethodGet, "/assets/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(srvFmtStatus, w.Code, http.StatusOK)
	}
	if got := w.Body.String(); got != indexContent {
		t.Errorf("body = %q, want index.html content", got)
	}
}

// TestSPAHandlerRootPath verifies that "/" serves index.html.
func TestSPAHandlerRootPath(t *testing.T) {
	indexContent := "<html>root</html>"
	fsys := fstest.MapFS{
		fileIndexHTML: {Data: []byte(indexContent)},
	}

	handler := spaHandler(fsys)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf(srvFmtStatus, w.Code, http.StatusOK)
	}
	if got := w.Body.String(); got != indexContent {
		t.Errorf("body = %q, want index.html content", got)
	}
}

// --- processHotkeyActions Tests ---

// TestProcessHotkeyActionsIncrement verifies that an "increment" action on
// the hotkey channel mutates the active pokemon's encounter count.
func TestProcessHotkeyActionsIncrement(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "increment"}
	close(ch)

	srv.processHotkeyActions(ch)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf("encounters = %d, want 1", st.Pokemon[0].Encounters)
	}
}

// TestProcessHotkeyActionsDecrement verifies that a "decrement" action
// reduces the encounter count.
func TestProcessHotkeyActionsDecrement(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	srv.state.Increment("p1")
	srv.state.Increment("p1")

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "decrement"}
	close(ch)

	srv.processHotkeyActions(ch)

	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf("encounters = %d, want 1", st.Pokemon[0].Encounters)
	}
}

// TestProcessHotkeyActionsReset verifies that a "reset" action broadcasts a
// confirmation request rather than resetting directly.
func TestProcessHotkeyActionsReset(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	srv.state.SetActive("p1")
	srv.state.Increment("p1")

	// Register a fake client to capture the broadcast.
	c := &wsClient{send: make(chan []byte, sendBufSize)}
	srv.hub.mu.Lock()
	srv.hub.clients[c] = true
	srv.hub.mu.Unlock()

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "reset"}
	close(ch)

	srv.processHotkeyActions(ch)

	// Encounters should NOT be reset (the server asks the frontend to confirm).
	st := srv.state.GetState()
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf("encounters = %d, want 1 (reset should not apply directly)", st.Pokemon[0].Encounters)
	}

	// The hub should have received a request_reset_confirm broadcast.
	select {
	case data := <-c.send:
		var msg WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if msg.Type != "request_reset_confirm" {
			t.Errorf("type = %q, want %q", msg.Type, "request_reset_confirm")
		}
	default:
		t.Error("no reset confirmation broadcast received")
	}
}

// TestProcessHotkeyActionsNext verifies that a "next" action cycles the
// active pokemon.
func TestProcessHotkeyActionsNext(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	addTestPokemon(t, srv, "p2", "Charmander")
	srv.state.SetActive("p1")

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "next"}
	close(ch)

	srv.processHotkeyActions(ch)

	st := srv.state.GetState()
	if st.ActiveID != "p2" {
		t.Errorf("ActiveID = %q, want %q", st.ActiveID, "p2")
	}
}

// TestProcessHotkeyActionsWithExplicitPokemonID verifies that an action with
// an explicit PokemonID uses that ID instead of the active pokemon.
func TestProcessHotkeyActionsWithExplicitPokemonID(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Pikachu")
	addTestPokemon(t, srv, "p2", "Charmander")
	srv.state.SetActive("p1")

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "increment", PokemonID: "p2"}
	close(ch)

	srv.processHotkeyActions(ch)

	st := srv.state.GetState()
	// p2 should be incremented, not p1.
	for _, p := range st.Pokemon {
		switch p.ID {
		case "p1":
			if p.Encounters != 0 {
				t.Errorf("p1 encounters = %d, want 0", p.Encounters)
			}
		case "p2":
			if p.Encounters != 1 {
				t.Errorf("p2 encounters = %d, want 1", p.Encounters)
			}
		}
	}
}

// TestProcessHotkeyActionsNoActive verifies that actions are skipped when
// there is no active pokemon and no explicit ID is provided.
func TestProcessHotkeyActionsNoActive(t *testing.T) {
	srv := newTestServer(t)

	ch := make(chan hotkeys.Action, 1)
	ch <- hotkeys.Action{Type: "increment"}
	close(ch)

	// Should not panic with no pokemon/active set.
	done := make(chan struct{})
	go func() {
		srv.processHotkeyActions(ch)
		close(done)
	}()

	select {
	case <-done:
		// ok
	case <-time.After(2 * time.Second):
		t.Fatal("processHotkeyActions did not return after channel close")
	}
}
