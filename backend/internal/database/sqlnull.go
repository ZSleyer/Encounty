// sqlnull.go holds the conversions between Go values and the nullable SQL
// types the schema uses. They were split across the save and load halves of
// the state persistence, one direction in each file, even though they are one
// concern and several rows need both directions.
package database

import (
	"database/sql"
	"time"
)

// nullStr extracts a string from a sql.NullString, returning "" if not valid.
func nullStr(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

// nullFloat extracts a float64 from a sql.NullFloat64, returning 0 if not valid.
func nullFloat(nf sql.NullFloat64) float64 {
	if nf.Valid {
		return nf.Float64
	}
	return 0
}

// nullInt extracts an int64 from a sql.NullInt64, returning 0 if not valid.
func nullInt(ni sql.NullInt64) int64 {
	if ni.Valid {
		return ni.Int64
	}
	return 0
}

// boolToInt converts a Go bool to a SQLite-compatible integer (0 or 1).
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nullTimeStr converts a *time.Time to a sql.NullString suitable for TEXT columns.
// Returns a null string if t is nil, otherwise an RFC3339-formatted UTC timestamp.
func nullTimeStr(t *time.Time) sql.NullString {
	if t == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: t.UTC().Format(time.RFC3339), Valid: true}
}
