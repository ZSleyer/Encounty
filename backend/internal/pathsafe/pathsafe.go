// Package pathsafe provides containment-checked filesystem path joining so that
// user-controlled path elements (ZIP entry names, URL paths, resource ids)
// cannot traverse outside an intended base directory.
package pathsafe

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Join cleans base and appends elems, returning an error if the resulting path
// would escape base (e.g. via ".." components). The returned path is always
// filepath.Clean-ed and guaranteed to be a strict descendant of base.
//
// The containment check is a prefix comparison against base plus a trailing
// separator rather than a filepath.Rel round trip: the separator rules out
// sibling directories that merely share a name prefix, and static analysis
// recognizes the shape as a path-traversal barrier.
func Join(base string, elems ...string) (string, error) {
	prefix := filepath.Clean(base) + string(filepath.Separator)
	joined := filepath.Join(append([]string{prefix}, elems...)...)
	if !strings.HasPrefix(joined, prefix) {
		return "", fmt.Errorf("path %q escapes base directory %q", filepath.Join(elems...), base)
	}
	return joined, nil
}
