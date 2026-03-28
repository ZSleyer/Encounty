package licenses

import (
	"encoding/json"
	"testing"
)

// TestAllReturnsNonNilSlice verifies that All() never returns nil.
func TestAllReturnsNonNilSlice(t *testing.T) {
	entries := All()
	if entries == nil {
		t.Fatal("All() returned nil, expected a non-nil slice")
	}
}

// TestAllReturnsEntries verifies that the embedded third_party.json contains
// at least one license entry.
func TestAllReturnsEntries(t *testing.T) {
	entries := All()
	if len(entries) == 0 {
		t.Fatal("All() returned an empty slice, expected at least one entry")
	}
}

// TestAllEntriesHaveRequiredFields checks that every entry has its Name,
// License, and Text fields populated.
func TestAllEntriesHaveRequiredFields(t *testing.T) {
	for i, e := range All() {
		if e.Name == "" {
			t.Errorf("entry %d has an empty Name", i)
		}
		if e.License == "" {
			t.Errorf("entry %d (%s) has an empty License", i, e.Name)
		}
		if e.Text == "" {
			t.Errorf("entry %d (%s) has an empty Text", i, e.Name)
		}
	}
}

// TestEntryJSONSerialization verifies that a json.Marshal/Unmarshal roundtrip
// preserves all fields of an Entry.
func TestEntryJSONSerialization(t *testing.T) {
	original := Entry{
		Name:    "example-lib",
		Version: "1.2.3",
		License: "MIT",
		Text:    "MIT License text here",
		Source:  "https://example.com",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var decoded Entry
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.Name != original.Name {
		t.Errorf("Name = %q, want %q", decoded.Name, original.Name)
	}
	if decoded.Version != original.Version {
		t.Errorf("Version = %q, want %q", decoded.Version, original.Version)
	}
	if decoded.License != original.License {
		t.Errorf("License = %q, want %q", decoded.License, original.License)
	}
	if decoded.Text != original.Text {
		t.Errorf("Text = %q, want %q", decoded.Text, original.Text)
	}
	if decoded.Source != original.Source {
		t.Errorf("Source = %q, want %q", decoded.Source, original.Source)
	}
}

// TestAllIdempotency verifies that calling All() multiple times returns the
// same slice, confirming the sync.Once behaviour.
func TestAllIdempotency(t *testing.T) {
	first := All()
	second := All()

	if len(first) != len(second) {
		t.Fatalf("length mismatch: first call returned %d, second returned %d", len(first), len(second))
	}

	for i := range first {
		if first[i] != second[i] {
			t.Errorf("entry %d differs between calls", i)
		}
	}
}
