// Package ziplimit bounds how far an uploaded ZIP archive may expand while it
// is being read.
//
// A limit on the upload itself is not enough: a few kilobytes of compressed
// zeroes decompress to gigabytes, so reading an entry with io.ReadAll hands an
// attacker an out-of-memory kill for the cost of a small POST. The sizes in the
// central directory are attacker-controlled too, so they are only used as a
// cheap early reject and the actual read is truncated as well.
package ziplimit

import (
	"archive/zip"
	"fmt"
	"io"
)

// Budget bounds a single archive traversal. The zero value rejects everything;
// callers set all three fields. A Budget is stateful and must not be reused
// across archives.
type Budget struct {
	// MaxEntries is how many entries may be read from the archive.
	MaxEntries int
	// MaxEntryBytes is the uncompressed size limit for one entry.
	MaxEntryBytes int64
	// MaxTotalBytes is the uncompressed size limit across all entries read.
	MaxTotalBytes int64

	entries int
	total   int64
}

// Read returns the uncompressed contents of f, or an error if reading it would
// exceed the budget. The returned slice never exceeds MaxEntryBytes.
func (b *Budget) Read(f *zip.File) ([]byte, error) {
	b.entries++
	if b.entries > b.MaxEntries {
		return nil, fmt.Errorf("archive has more than %d entries", b.MaxEntries)
	}
	if f.UncompressedSize64 > uint64(b.MaxEntryBytes) {
		return nil, fmt.Errorf("entry %q declares %d bytes, limit is %d", f.Name, f.UncompressedSize64, b.MaxEntryBytes)
	}

	limit := b.MaxEntryBytes
	if remaining := b.MaxTotalBytes - b.total; remaining < limit {
		limit = remaining
	}

	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()

	// limit+1 so a full read is distinguishable from a truncated one.
	data, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("entry %q exceeds the uncompressed size budget", f.Name)
	}

	b.total += int64(len(data))
	return data, nil
}
