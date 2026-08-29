// backgrounds_test.go covers the storage of overlay background images.
package database_test

import (
	"path/filepath"
	"testing"

	"github.com/zsleyer/encounty/backend/internal/database"
	"github.com/zsleyer/encounty/backend/internal/state"
)

func TestBackgroundRoundTrip(t *testing.T) {
	db := openTestDB(t)

	if db.HasBackground("bg_1.png") {
		t.Fatal("a fresh database reports a background that was never stored")
	}
	if err := db.SaveBackground("bg_1.png", []byte("image-bytes"), "image/png"); err != nil {
		t.Fatalf("SaveBackground: %v", err)
	}
	if !db.HasBackground("bg_1.png") {
		t.Error("HasBackground = false after storing")
	}

	data, mime, err := db.LoadBackground("bg_1.png")
	if err != nil {
		t.Fatalf("LoadBackground: %v", err)
	}
	if string(data) != "image-bytes" || mime != "image/png" {
		t.Errorf("loaded %q/%q, want %q/image/png", string(data), mime, "image-bytes")
	}

	// The same name replaces rather than duplicating.
	if err := db.SaveBackground("bg_1.png", []byte("newer"), "image/jpeg"); err != nil {
		t.Fatalf("SaveBackground (replace): %v", err)
	}
	data, mime, err = db.LoadBackground("bg_1.png")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "newer" || mime != "image/jpeg" {
		t.Errorf("after replacing: %q/%q", string(data), mime)
	}

	if err := db.DeleteBackground("bg_1.png"); err != nil {
		t.Fatalf("DeleteBackground: %v", err)
	}
	if _, _, err := db.LoadBackground("bg_1.png"); err == nil {
		t.Error("LoadBackground succeeded after the image was deleted")
	}
	// Deleting one that is not there is not an error.
	if err := db.DeleteBackground("bg_1.png"); err != nil {
		t.Errorf("DeleteBackground on a missing image: %v", err)
	}
}

// TestDeleteOrphanBackgrounds verifies that only images no overlay references
// are removed. Overlays exist globally and per Pokémon, and two of them may
// carry the same image, which is why the check spans every row.
func TestDeleteOrphanBackgrounds(t *testing.T) {
	db := openTestDB(t)

	for _, name := range []string{"used.png", "shared.png", "orphan.png"} {
		if err := db.SaveBackground(name, []byte("x"), "image/png"); err != nil {
			t.Fatal(err)
		}
	}

	st := state.AppState{
		Pokemon: []state.Pokemon{
			{ID: "p1", Name: "Pikachu", OverlayMode: "custom", Overlay: &state.OverlaySettings{BackgroundImage: "shared.png"}},
			{ID: "p2", Name: "Evoli", OverlayMode: "custom", Overlay: &state.OverlaySettings{BackgroundImage: "shared.png"}},
		},
	}
	st.Settings.Overlay.BackgroundImage = "used.png"
	if err := db.SaveFullState(&st); err != nil {
		t.Fatalf("SaveFullState: %v", err)
	}

	n, err := db.DeleteOrphanBackgrounds()
	if err != nil {
		t.Fatalf("DeleteOrphanBackgrounds: %v", err)
	}
	if n != 1 {
		t.Errorf("removed %d images, want 1", n)
	}
	for _, name := range []string{"used.png", "shared.png"} {
		if !db.HasBackground(name) {
			t.Errorf("%s was removed although an overlay references it", name)
		}
	}
	if db.HasBackground("orphan.png") {
		t.Error("the unreferenced image survived")
	}
}

// TestBackgroundsSurviveASnapshot is the property the whole change is about: a
// backup is a copy of the database, so it carries the images.
func TestBackgroundsSurviveASnapshot(t *testing.T) {
	db := openTestDB(t)
	if err := db.SaveBackground("bg_2.png", []byte("payload"), "image/png"); err != nil {
		t.Fatal(err)
	}

	dest := filepath.Join(t.TempDir(), "snapshot.db")
	if err := db.Snapshot(dest); err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	copyDB, err := database.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = copyDB.Close() })

	data, _, err := copyDB.LoadBackground("bg_2.png")
	if err != nil || string(data) != "payload" {
		t.Errorf("snapshot lost the background: %q, %v", string(data), err)
	}
}
