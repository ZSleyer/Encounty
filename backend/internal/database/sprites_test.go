// sprites_test.go covers the pokemon sprite BLOB storage round-trip and the
// cascade delete when a pokemon is removed from state.
package database_test

import (
	"bytes"
	"testing"
)

// TestSaveLoadDeleteSprite verifies the SaveSprite/LoadSprite/DeleteSprite
// round-trip, including upsert-on-conflict behavior.
func TestSaveLoadDeleteSprite(t *testing.T) {
	db := openTestDB(t)

	// A pokemon row must exist first because of the FK constraint.
	st := makeTestState()
	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf(fmtSaveErr, err)
	}

	blob := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xDE, 0xAD}
	if err := db.SaveSprite("p1", blob, "image/png"); err != nil {
		t.Fatalf("SaveSprite: %v", err)
	}

	got, mime, err := db.LoadSprite("p1")
	if err != nil {
		t.Fatalf("LoadSprite: %v", err)
	}
	if mime != "image/png" {
		t.Errorf("mime = %q, want image/png", mime)
	}
	if !bytes.Equal(got, blob) {
		t.Errorf("LoadSprite bytes mismatch: got %v, want %v", got, blob)
	}

	// Saving again for the same pokemon must replace the previous sprite.
	blob2 := []byte{0x47, 0x49, 0x46, 0x38}
	if err := db.SaveSprite("p1", blob2, "image/gif"); err != nil {
		t.Fatalf("SaveSprite (replace): %v", err)
	}
	got, mime, err = db.LoadSprite("p1")
	if err != nil {
		t.Fatalf("LoadSprite (after replace): %v", err)
	}
	if mime != "image/gif" || !bytes.Equal(got, blob2) {
		t.Errorf("replace failed: got mime=%q bytes=%v", mime, got)
	}

	if err := db.DeleteSprite("p1"); err != nil {
		t.Fatalf("DeleteSprite: %v", err)
	}
	if _, _, err := db.LoadSprite("p1"); err == nil {
		t.Fatal("LoadSprite should return error after delete")
	}
}

// TestSpriteCascadeOnPokemonDelete verifies the sprite row is removed when its
// owning pokemon is deleted from state (ON DELETE CASCADE).
func TestSpriteCascadeOnPokemonDelete(t *testing.T) {
	db := openTestDB(t)

	st := makeTestState()
	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState (initial): %v", err)
	}
	if err := db.SaveSprite("p2", []byte{0x01, 0x02, 0x03}, "image/png"); err != nil {
		t.Fatalf("SaveSprite: %v", err)
	}

	// Remove p2 from state and save again.
	st.Pokemon = st.Pokemon[:1] // keep only p1
	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState (after remove): %v", err)
	}

	if _, _, err := db.LoadSprite("p2"); err == nil {
		t.Fatal("sprite should be gone after pokemon removal")
	}
}
