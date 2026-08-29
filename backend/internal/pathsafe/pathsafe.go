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

// Under reports whether dir lies inside base, returning the cleaned directory
// when it does. Unlike Join it takes a complete path rather than assembling
// one, which is what a user-supplied directory needs.
//
// The cleaned path is returned rather than reused from the argument on purpose:
// callers must pass the result on to the filesystem, so the containment check
// sits between the untrusted input and every use of it. The base itself is
// answered with base, not with the caller's spelling of it.
func Under(base, dir string) (string, bool) {
	cleanBase := filepath.Clean(base)
	cleaned := filepath.Clean(dir)
	if cleaned == cleanBase {
		return cleanBase, true
	}
	prefix := cleanBase + string(filepath.Separator)
	if !strings.HasPrefix(cleaned, prefix) {
		return "", false
	}
	return cleaned, true
}

// UnderAny reports whether dir lies inside any of roots, returning the cleaned
// directory from the first root that contains it. Empty roots answer false.
func UnderAny(dir string, roots ...string) (string, bool) {
	for _, root := range roots {
		if root == "" {
			continue
		}
		if cleaned, ok := Under(root, dir); ok {
			return cleaned, true
		}
	}
	return "", false
}
