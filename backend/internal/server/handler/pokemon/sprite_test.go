// sprite_test.go covers the sprite upload/serve HTTP handlers: validation,
// size limits, mime sniffing, and sprite_url updates.
package pokemon

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const pathSpriteP1 = "/api/pokemon/p1/sprite"

// TestSpriteUploadValidPNG verifies a small PNG is stored and sprite_url is set.
func TestSpriteUploadValidPNG(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	png := smallPNG(t)

	req := httptest.NewRequest(http.MethodPost, pathSpriteP1, bytes.NewReader(png))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}
	var resp spriteResponse
	decodeJSON(t, w, &resp)
	if !strings.HasPrefix(resp.SpriteURL, "/api/pokemon/p1/sprite?v=") {
		t.Errorf("sprite_url = %q, want prefix /api/pokemon/p1/sprite?v=", resp.SpriteURL)
	}

	stored, ok := deps.spriteStore.sprites["p1"]
	if !ok {
		t.Fatal("sprite was not stored")
	}
	if stored.mime != "image/png" {
		t.Errorf("mime = %q, want image/png", stored.mime)
	}
	if !bytes.Equal(stored.data, png) {
		t.Error("stored bytes do not match uploaded bytes")
	}

	// The Pokemon's sprite_url should have been updated in state.
	st := deps.stateMgr.GetState()
	if st.Pokemon[0].SpriteURL != resp.SpriteURL {
		t.Errorf("pokemon sprite_url = %q, want %q", st.Pokemon[0].SpriteURL, resp.SpriteURL)
	}
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}
}

// TestSpriteUploadUnknownPokemon verifies an upload for a missing Pokemon returns
// 404 and stores nothing.
func TestSpriteUploadUnknownPokemon(t *testing.T) {
	mux, deps := newTestMux(t)
	png := smallPNG(t)

	req := httptest.NewRequest(http.MethodPost, pathSpriteP1, bytes.NewReader(png))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
	if len(deps.spriteStore.sprites) != 0 {
		t.Error("nothing should have been stored for unknown pokemon")
	}
}

// TestSpriteUploadOverLimit verifies a body over the 4 MB cap returns 413 and
// writes nothing to the store.
func TestSpriteUploadOverLimit(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	big := bytes.Repeat([]byte{0x41}, spriteMaxBytes+1)
	req := httptest.NewRequest(http.MethodPost, pathSpriteP1, bytes.NewReader(big))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusRequestEntityTooLarge)
	}
	if len(deps.spriteStore.sprites) != 0 {
		t.Error("nothing should have been stored when over the size limit")
	}
}

// TestSpriteUploadNonImage verifies a non-image body returns 400 and stores
// nothing.
func TestSpriteUploadNonImage(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodPost, pathSpriteP1, strings.NewReader("this is not an image"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusBadRequest)
	}
	if len(deps.spriteStore.sprites) != 0 {
		t.Error("nothing should have been stored for non-image body")
	}
}

// TestSpriteGetServesBytes verifies GET returns the stored bytes and mime.
func TestSpriteGetServesBytes(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	png := smallPNG(t)
	if err := deps.spriteStore.SaveSprite("p1", png, "image/png"); err != nil {
		t.Fatalf("seed sprite: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, pathSpriteP1, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if !bytes.Equal(w.Body.Bytes(), png) {
		t.Error("served bytes do not match stored bytes")
	}
}

// TestSpriteGetMissing verifies GET returns 404 when no sprite exists.
func TestSpriteGetMissing(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")

	req := httptest.NewRequest(http.MethodGet, pathSpriteP1, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}

// TestSpriteDelete verifies DELETE removes the stored sprite, clears the
// Pokemon's sprite_url in state, and a subsequent GET returns 404.
func TestSpriteDelete(t *testing.T) {
	mux, deps := newTestMux(t)
	addPokemon(t, deps, "p1", "Pikachu")
	png := smallPNG(t)

	uploadReq := httptest.NewRequest(http.MethodPost, pathSpriteP1, bytes.NewReader(png))
	uploadW := httptest.NewRecorder()
	mux.ServeHTTP(uploadW, uploadReq)
	if uploadW.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, uploadW.Code, http.StatusOK)
	}

	req := httptest.NewRequest(http.MethodDelete, pathSpriteP1, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusOK)
	}
	var resp spriteResponse
	decodeJSON(t, w, &resp)
	if resp.SpriteURL != "" {
		t.Errorf("sprite_url = %q, want empty", resp.SpriteURL)
	}

	if _, ok := deps.spriteStore.sprites["p1"]; ok {
		t.Error("sprite should have been deleted from the store")
	}

	st := deps.stateMgr.GetState()
	if st.Pokemon[0].SpriteURL != "" {
		t.Errorf("pokemon sprite_url = %q, want empty", st.Pokemon[0].SpriteURL)
	}
	if deps.saveCount == 0 {
		t.Error(fmtWantSaveCall)
	}

	getReq := httptest.NewRequest(http.MethodGet, pathSpriteP1, nil)
	getW := httptest.NewRecorder()
	mux.ServeHTTP(getW, getReq)
	if getW.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, getW.Code, http.StatusNotFound)
	}
}

// TestSpriteDeleteUnknownPokemon verifies a delete for a missing Pokemon
// returns 404.
func TestSpriteDeleteUnknownPokemon(t *testing.T) {
	mux, _ := newTestMux(t)

	req := httptest.NewRequest(http.MethodDelete, pathSpriteP1, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf(fmtWantStatus, w.Code, http.StatusNotFound)
	}
}
