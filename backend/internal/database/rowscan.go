// rowscan.go holds the row iteration helper the batched readers in this
// package share. The query, the deferred close, the row loop and the closing
// rows.Err() check were spelled out at more than twenty call sites. Every one
// of them already checked rows.Err(); the helper removes the repetition and
// makes leaving the check out impossible from here on.

package database

import "database/sql"

// scanRows hands every row to scan, closes the result set and returns the first
// error among the callback and rows.Err(). The callback owns its own scan and
// the wording of its error, because the call sites disagree on how they label a
// scan failure and every message has to stay what it was.
//
// Callers that label a failing Query keep the Query and hand the open rows
// over; everyone else goes through eachRow.
func scanRows(rows *sql.Rows, scan func(*sql.Rows) error) error {
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// eachRow runs query on db and hands every row to scan. The query error is
// returned unwrapped, matching the call sites that never labelled it.
//
// Callers inside a transaction run their own Query and go through scanRows
// instead, so this takes the concrete handle rather than an interface that
// would have exactly one implementation.
func eachRow(db *sql.DB, query string, args []any, scan func(*sql.Rows) error) error {
	rows, err := db.Query(query, args...)
	if err != nil {
		return err
	}
	return scanRows(rows, scan)
}
