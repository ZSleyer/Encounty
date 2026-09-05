// Package pathsafe provides containment-checked filesystem path joining so that
// user-controlled path elements (ZIP entry names, URL paths, resource ids)
// cannot traverse outside an intended base directory, whether through ".."
// components or through a symlink that points out of the base.
package pathsafe

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
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
//
// The check is deliberately lexical, unlike Under: the bases this is called
// with belong to the application itself, so planting a symlink inside one
// already requires write access to the installation.
func Join(base string, elems ...string) (string, error) {
	prefix := filepath.Clean(base) + string(filepath.Separator)
	joined := filepath.Join(append([]string{prefix}, elems...)...)
	if !strings.HasPrefix(joined, prefix) {
		return "", fmt.Errorf("path %q escapes base directory %q", filepath.Join(elems...), base)
	}
	return joined, nil
}

// Under reports whether dir lies inside base, returning the resolved directory
// when it does. Unlike Join it takes a complete path rather than assembling
// one, which is what a user-supplied directory needs.
//
// Both sides are resolved before they are compared, because filepath.Clean
// only removes ".." textually: a symlink inside base that points out of it
// would otherwise pass a purely lexical check while every file operation
// following that path lands outside. Resolving base as well keeps a base that
// is itself reached through a symlink (/var on macOS, a home directory on a
// mounted volume) from rejecting everything under it.
//
// The resolved path is returned rather than the caller's spelling on purpose:
// callers pass the result on to the filesystem and store it, and a stored path
// that still contains a symlink component can be repointed after the check.
// Anything that cannot be resolved is answered as not contained.
func Under(base, dir string) (string, bool) {
	// A relative path would resolve against the process working directory,
	// which is not a location any caller means to talk about.
	if !filepath.IsAbs(dir) {
		return "", false
	}
	realBase, err := resolve(base)
	if err != nil {
		return "", false
	}
	realDir, err := resolve(dir)
	if err != nil {
		return "", false
	}
	if realDir == realBase {
		return realBase, true
	}
	if !strings.HasPrefix(realDir, realBase+string(filepath.Separator)) {
		return "", false
	}
	return realDir, true
}

// UnderAny reports whether dir lies inside any of roots, returning the resolved
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

// resolve returns path with every symlink along it resolved.
//
// filepath.EvalSymlinks fails on a path that does not exist, and callers
// legitimately name a directory that is about to be created, so the deepest
// existing ancestor is resolved and the remaining components are appended
// unchanged. Components that do not exist cannot be symlinks, which is what
// makes that sound.
//
// Every other error is returned rather than walked past. Continuing over a
// permission error would leave an unresolved component in the result, which is
// exactly the case this function exists to rule out.
func resolve(path string) (string, error) {
	cleaned := filepath.Clean(path)
	var tail string
	for {
		resolved, err := filepath.EvalSymlinks(cleaned)
		if err == nil {
			return filepath.Join(resolved, tail), nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		// A symlink whose target does not exist yet reports the same error as
		// a component that does not exist at all, and only the second may be
		// carried over unresolved: the first is a link that can be made to
		// point anywhere the moment its target is created.
		if _, lerr := os.Lstat(cleaned); lerr == nil {
			return "", fmt.Errorf("%q cannot be resolved: %w", cleaned, err)
		}
		parent := filepath.Dir(cleaned)
		if parent == cleaned {
			return "", fmt.Errorf("no existing ancestor of %q: %w", path, err)
		}
		tail = filepath.Join(filepath.Base(cleaned), tail)
		cleaned = parent
	}
}
