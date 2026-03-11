package licenses

import (
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
