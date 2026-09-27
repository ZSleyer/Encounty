package keycombo

import "testing"

// TestCanonicalFoldsOrderAliasesAndCase checks that every spelling the parser
// maps to one physical key yields the same canonical string.
func TestCanonicalFoldsOrderAliasesAndCase(t *testing.T) {
	cases := []struct{ a, b string }{
		{"Ctrl+Shift+F1", "Shift+Ctrl+F1"},
		{"Control+F1", "Ctrl+F1"},
		{"ctrl+alt+shift+a", "Shift+Alt+Control+A"},
		{"F5", "f5"},
		{" Ctrl + F2 ", "ctrl+f2"},
		{"Ctrl++", "control++"},
	}
	for _, tc := range cases {
		if !Same(tc.a, tc.b) {
			t.Errorf("Same(%q, %q) = false, want true (canonical %q vs %q)", tc.a, tc.b, Canonical(tc.a), Canonical(tc.b))
		}
	}
}

// TestSameDistinguishesDifferentKeys guards against the normalizer folding
// too much.
func TestSameDistinguishesDifferentKeys(t *testing.T) {
	cases := []struct{ a, b string }{
		{"Ctrl+F1", "F1"},
		{"Ctrl+F1", "Alt+F1"},
		{"F1", "F2"},
		{"", ""},
		{"", "F1"},
	}
	for _, tc := range cases {
		if Same(tc.a, tc.b) {
			t.Errorf("Same(%q, %q) = true, want false", tc.a, tc.b)
		}
	}
}

// TestCanonicalUnparseableFallsBack checks that a combo Parse rejects is still
// compared by its trimmed lowercase form.
func TestCanonicalUnparseableFallsBack(t *testing.T) {
	if got := Canonical(" Ctrl+ "); got != "ctrl+" {
		t.Errorf("Canonical(unparseable) = %q, want %q", got, "ctrl+")
	}
	if !Same("Ctrl+ ", "CTRL+") {
		t.Error("unparseable combos differing only in case and spacing should match")
	}
}
