package ziplimit

import (
	"archive/zip"
	"bytes"
	"testing"
)

// buildZip returns an in-memory ZIP with one entry per name/size pair, filled
// with zero bytes so the compressed archive stays tiny regardless of size.
func buildZip(t *testing.T, entries map[string]int) *zip.Reader {
	t.Helper()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, size := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create entry: %v", err)
		}
		if _, err := w.Write(make([]byte, size)); err != nil {
			t.Fatalf("write entry: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open reader: %v", err)
	}
	return zr
}

// TestBudgetReadWithinLimits verifies that a normal entry is returned intact.
func TestBudgetReadWithinLimits(t *testing.T) {
	zr := buildZip(t, map[string]int{"small.png": 1024})
	b := &Budget{MaxEntries: 10, MaxEntryBytes: 4096, MaxTotalBytes: 8192}

	data, err := b.Read(zr.File[0])
	if err != nil {
		t.Fatalf("Read() error = %v, want nil", err)
	}
	if len(data) != 1024 {
		t.Errorf("len(data) = %d, want 1024", len(data))
	}
}

// TestBudgetRejectsZipBomb verifies that a highly compressible entry is refused
// instead of being expanded into memory.
func TestBudgetRejectsZipBomb(t *testing.T) {
	const bombSize = 50 << 20
	zr := buildZip(t, map[string]int{"bomb.bin": bombSize})

	if compressed := zr.File[0].CompressedSize64; compressed > 1<<20 {
		t.Fatalf("test fixture is not compressible enough: %d bytes", compressed)
	}

	b := &Budget{MaxEntries: 10, MaxEntryBytes: 1 << 20, MaxTotalBytes: 4 << 20}
	if _, err := b.Read(zr.File[0]); err == nil {
		t.Error("Read() error = nil, want a size limit error")
	}
}

// TestBudgetRejectsUnderreportedSize verifies that the read is truncated even
// when the central directory understates the entry size, which an attacker
// controls.
func TestBudgetRejectsUnderreportedSize(t *testing.T) {
	zr := buildZip(t, map[string]int{"liar.bin": 4 << 20})
	f := zr.File[0]
	f.UncompressedSize64 = 16
	f.UncompressedSize = 16

	b := &Budget{MaxEntries: 10, MaxEntryBytes: 1 << 20, MaxTotalBytes: 4 << 20}
	if _, err := b.Read(f); err == nil {
		t.Error("Read() error = nil, want a size limit error")
	}
}

// TestBudgetEnforcesTotalAndCount verifies the cross-entry limits.
func TestBudgetEnforcesTotalAndCount(t *testing.T) {
	zr := buildZip(t, map[string]int{"a.bin": 1024, "b.bin": 1024, "c.bin": 1024})

	t.Run("total bytes", func(t *testing.T) {
		b := &Budget{MaxEntries: 10, MaxEntryBytes: 4096, MaxTotalBytes: 1500}
		if _, err := b.Read(zr.File[0]); err != nil {
			t.Fatalf("first Read() error = %v, want nil", err)
		}
		if _, err := b.Read(zr.File[1]); err == nil {
			t.Error("second Read() error = nil, want a total budget error")
		}
	})

	t.Run("entry count", func(t *testing.T) {
		b := &Budget{MaxEntries: 1, MaxEntryBytes: 4096, MaxTotalBytes: 1 << 20}
		if _, err := b.Read(zr.File[0]); err != nil {
			t.Fatalf("first Read() error = %v, want nil", err)
		}
		if _, err := b.Read(zr.File[1]); err == nil {
			t.Error("second Read() error = nil, want an entry count error")
		}
	})
}
