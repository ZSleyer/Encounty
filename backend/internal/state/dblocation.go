// dblocation.go records which directory holds the SQLite database. The
// database cannot store its own location: the backend has to know where to
// open it before any query can run, so the path lives in a small file inside
// the (static) configuration directory.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	// DBFilename is the name of the SQLite database file.
	DBFilename = "encounty.db"

	// dbLocationFile is the name of the record inside the configuration directory.
	dbLocationFile = "db-location.json"
)

// dbLocation is the on-disk shape of the record.
type dbLocation struct {
	DBDir string `json:"db_dir"`
}

// dbLocationPath returns the full path of the record for a configuration
// directory.
func dbLocationPath(configDir string) string {
	return filepath.Join(configDir, dbLocationFile)
}

// ReadDBDir returns the directory the database was relocated to, or an empty
// string when no relocation was ever recorded. A malformed record is an error
// rather than a silent fallback: the database is elsewhere and guessing the
// default would open an empty one in its place.
func ReadDBDir(configDir string) (string, error) {
	data, err := os.ReadFile(dbLocationPath(configDir))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var loc dbLocation
	if err := json.Unmarshal(data, &loc); err != nil {
		return "", fmt.Errorf("parse %s: %w", dbLocationFile, err)
	}
	return loc.DBDir, nil
}

// WriteDBDir records dbDir as the database directory for configDir. The write
// goes through a temporary file so an interrupted save cannot leave a truncated
// record behind, which would read as "no relocation" and open an empty database
// at the default location.
func WriteDBDir(configDir, dbDir string) error {
	data, err := json.MarshalIndent(dbLocation{DBDir: dbDir}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}
	path := dbLocationPath(configDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ClearDBDir removes the record, which puts the database back at the
// configuration directory itself. Removing a record that is not there succeeds.
func ClearDBDir(configDir string) error {
	if err := os.Remove(dbLocationPath(configDir)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// ResolveDBDir returns the directory the database should be opened in for a
// given configuration directory. A recorded location that no longer exists (an
// external drive that is not mounted) falls back to the configuration directory
// for this session without discarding the record, so the database returns to
// its chosen home once the path is reachable again.
func ResolveDBDir(configDir string) string {
	recorded, err := ReadDBDir(configDir)
	if err != nil {
		slog.Warn("Could not read the database location record, using the config directory", "error", err)
		return configDir
	}
	if recorded == "" || recorded == configDir {
		return configDir
	}
	if info, err := os.Stat(recorded); err != nil || !info.IsDir() {
		slog.Warn("Recorded database location is unavailable, falling back to the config directory",
			"path", recorded, "error", err)
		return configDir
	}
	return recorded
}
