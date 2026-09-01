// rowscan_test.go covers the shared row iteration helper, above all that it
// reports the error SQLite raises while stepping. Swallowing rows.Err() would
// turn a partial read into an apparently complete one, which is the failure
// mode the helper exists to prevent.

package database

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// openScratchDB opens an empty SQLite database without the application schema,
// so the helper can be exercised against tables shaped for the test alone.
func openScratchDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "rowscan.db"))
	if err != nil {
		t.Fatalf("open scratch database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// TestEachRowPropagatesRowsErr verifies that an error raised while stepping
// through the result set reaches the caller. The second row holds text that is
// not JSON, so json_extract fails on that step and not on the query: the first
// row still reaches the callback, and only rows.Err() reports the failure.
func TestEachRowPropagatesRowsErr(t *testing.T) {
	db := openScratchDB(t)
	if _, err := db.Exec(`CREATE TABLE payloads (body TEXT)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO payloads (body) VALUES ('{"n":1}'), ('not json')`); err != nil {
		t.Fatalf("seed rows: %v", err)
	}

	seen := 0
	err := eachRow(db, `SELECT json_extract(body, '$.n') FROM payloads`, nil, func(rows *sql.Rows) error {
		var n sql.NullInt64
		if err := rows.Scan(&n); err != nil {
			return err
		}
		seen++
		return nil
	})
	if err == nil {
		t.Fatal("eachRow swallowed the step error, a partial read would look complete")
	}
	if !strings.Contains(err.Error(), "malformed JSON") {
		t.Errorf("eachRow returned %v, want the malformed JSON step error", err)
	}
	if seen != 1 {
		t.Errorf("callback ran %d times, want 1 before the failing step", seen)
	}
}

// TestEachRowPropagatesQueryError verifies that a failing Query is returned
// unwrapped, which is what the call sites that label it themselves rely on.
func TestEachRowPropagatesQueryError(t *testing.T) {
	db := openScratchDB(t)
	err := eachRow(db, `SELECT 1 FROM missing_table`, nil, func(*sql.Rows) error {
		t.Error("callback ran although the query failed")
		return nil
	})
	if err == nil {
		t.Fatal("eachRow returned nil for a query against a missing table")
	}
}

// TestEachRowPropagatesCallbackError verifies that the callback's own error
// stops the iteration and reaches the caller unchanged.
func TestEachRowPropagatesCallbackError(t *testing.T) {
	db := openScratchDB(t)
	if _, err := db.Exec(`CREATE TABLE nums (n INTEGER)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO nums (n) VALUES (1), (2), (3)`); err != nil {
		t.Fatalf("seed rows: %v", err)
	}

	sentinel := errors.New("callback refused the row")
	seen := 0
	err := eachRow(db, `SELECT n FROM nums ORDER BY n`, nil, func(*sql.Rows) error {
		seen++
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("eachRow returned %v, want the callback error", err)
	}
	if seen != 1 {
		t.Errorf("callback ran %d times, want 1 before the iteration stopped", seen)
	}
}

// TestEachRowPassesArguments verifies that the placeholder arguments reach the
// query, since the helper forwards them through a slice rather than a variadic.
func TestEachRowPassesArguments(t *testing.T) {
	db := openScratchDB(t)
	if _, err := db.Exec(`CREATE TABLE nums (n INTEGER)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO nums (n) VALUES (1), (2), (3)`); err != nil {
		t.Fatalf("seed rows: %v", err)
	}

	var got []int64
	err := eachRow(db, `SELECT n FROM nums WHERE n > ? ORDER BY n`, []any{1}, func(rows *sql.Rows) error {
		var n int64
		if err := rows.Scan(&n); err != nil {
			return err
		}
		got = append(got, n)
		return nil
	})
	if err != nil {
		t.Fatalf("eachRow: %v", err)
	}
	if len(got) != 2 || got[0] != 2 || got[1] != 3 {
		t.Errorf("eachRow collected %v, want [2 3]", got)
	}
}

// TestScanRowsClosesRows verifies that scanRows closes the result set it is
// handed, which is the guarantee the call sites give up when they stop writing
// their own deferred Close.
func TestScanRowsClosesRows(t *testing.T) {
	db := openScratchDB(t)
	if _, err := db.Exec(`CREATE TABLE nums (n INTEGER)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO nums (n) VALUES (1)`); err != nil {
		t.Fatalf("seed rows: %v", err)
	}

	rows, err := db.Query(`SELECT n FROM nums`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if err := scanRows(rows, func(*sql.Rows) error { return nil }); err != nil {
		t.Fatalf("scanRows: %v", err)
	}
	if err := rows.Scan(new(int64)); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Errorf("rows are still usable after scanRows, got %v", err)
	}
}
