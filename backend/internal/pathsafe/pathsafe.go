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
// filepath.Clean-ed and guaranteed to be base itself or a descendant of it.
func Join(base string, elems ...string) (string, error) {
	cleanBase := filepath.Clean(base)
	joined := filepath.Join(append([]string{cleanBase}, elems...)...)
	rel, err := filepath.Rel(cleanBase, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q escapes base directory %q", filepath.Join(elems...), base)
	}
	return joined, nil
}
