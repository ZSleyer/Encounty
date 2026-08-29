// Package database provides SQLite-backed encounter and timer history.
// It uses modernc.org/sqlite (pure Go, no CGO) for cross-platform builds.
package database

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	_ "modernc.org/sqlite"
)

// ErrPokedexOverrideConflict reports that an override move targets an occupied scope.
var ErrPokedexOverrideConflict = errors.New("pokedex override scope already exists")

// DB wraps the SQLite connection pool.
type DB struct {
	db *sql.DB
}

// EncounterEvent records one encounter count change.
type EncounterEvent struct {
	ID          int64  `json:"id"`
	PokemonID   string `json:"pokemon_id"`
	PokemonName string `json:"pokemon_name"`
	Timestamp   string `json:"timestamp"`
	Delta       int    `json:"delta"`
	CountAfter  int    `json:"count_after"`
	Source      string `json:"source"`
}

// EncounterStats holds aggregated encounter statistics for one Pokemon.
type EncounterStats struct {
	Total       int     `json:"total"`
	Today       int     `json:"today"`
	RatePerHour float64 `json:"rate_per_hour"`
	FirstAt     string  `json:"first_at,omitempty"`
	LastAt      string  `json:"last_at,omitempty"`
}

// ChartPoint is one data point for the encounter chart.
type ChartPoint struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

// OverviewStats holds global statistics across all Pokemon.
type OverviewStats struct {
	TotalEncounters int `json:"total_encounters"`
	TotalPokemon    int `json:"total_pokemon"`
	Today           int `json:"today"`
}

// TimerSession records one timer start/stop cycle.
type TimerSession struct {
	ID               int64  `json:"id"`
	PokemonID        string `json:"pokemon_id"`
	StartedAt        string `json:"started_at"`
	EndedAt          string `json:"ended_at,omitempty"`
	EncountersDuring int    `json:"encounters_during"`
}

// GameRow represents a single game entry as stored in the database.
type GameRow struct {
	Key        string
	NamesJSON  []byte
	Generation int
	Platform   string
}

// Open creates or opens a SQLite database at path and runs migrations.
// If the initial connection or migration fails (e.g. due to a locked file
// from another process), it retries up to 3 times with a short delay.
func Open(path string) (*DB, error) {
	dsn := path + "?_pragma=journal_mode(wal)&_pragma=busy_timeout(5000)"

	var lastErr error
	for attempt := range 3 {
		db, err := tryOpen(dsn)
		if err == nil {
			return db, nil
		}
		lastErr = err
		if attempt < 2 {
			time.Sleep(500 * time.Millisecond)
		}
	}
	return nil, lastErr
}

// tryOpen performs a single attempt to open the database and run migrations.
func tryOpen(dsn string) (*DB, error) {
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	sqlDB.SetMaxOpenConns(1)

	// Force an actual connection to detect file-level errors early.
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	// Enable foreign key enforcement before any migrations or queries.
	// This must be set per-connection and outside transactions (SQLite requirement).
	if _, err := sqlDB.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	d := &DB{db: sqlDB}
	if err := d.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

// Close checkpoints the write-ahead log and closes the connection.
//
// SQLite checkpoints on its own when the last connection to a database goes
// away, but only then. Doing it explicitly means the main database file is
// current the moment Close returns, so whatever reads the file afterwards
// (a backup, a config-directory move, the next process) sees every committed
// transaction rather than an empty file next to a fat -wal.
func (d *DB) Close() error {
	if _, err := d.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		slog.Warn("WAL checkpoint before close failed", "error", err)
	}
	return d.db.Close()
}

// RemoveSidecars deletes the write-ahead log and shared-memory files belonging
// to dbPath. They describe the database that was there a moment ago, so leaving
// them next to a replaced or removed file would let SQLite replay them over it.
func RemoveSidecars(dbPath string) {
	for _, suffix := range []string{"-wal", "-shm"} {
		if err := os.Remove(dbPath + suffix); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("Failed to remove database sidecar", "file", dbPath+suffix, "error", err)
		}
	}
}

// Snapshot writes a consistent copy of the database to destPath, which must not
// hold an existing database. VACUUM INTO runs inside a read transaction, so the
// copy includes everything committed to the write-ahead log and nothing
// half-written, which a plain file copy cannot promise while the app is running.
func (d *DB) Snapshot(destPath string) error {
	if _, err := d.db.Exec(`VACUUM INTO ?`, destPath); err != nil {
		return fmt.Errorf("snapshot database: %w", err)
	}
	return nil
}

func (d *DB) migrate() error {
	return RunMigrations(d.db)
}

// MigrationVersion returns the highest applied migration version, or 0 if
// no migrations have been recorded yet.
func (d *DB) MigrationVersion() int {
	var v int
	_ = d.db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM migrations`).Scan(&v)
	return v
}

// DeleteEncounterEvents removes all encounter events for a Pokemon,
// typically called when its counter is reset.
func (d *DB) DeleteEncounterEvents(pokemonID string) error {
	_, err := d.db.Exec(`DELETE FROM encounter_events WHERE pokemon_id = ?`, pokemonID)
	return err
}

// LogEncounter records an encounter event.
func (d *DB) LogEncounter(pokemonID, pokemonName string, delta, countAfter int, source string) error {
	_, err := d.db.Exec(
		`INSERT INTO encounter_events (pokemon_id, pokemon_name, timestamp, delta, count_after, source)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		pokemonID, pokemonName, time.Now().UTC().Format(time.RFC3339), delta, countAfter, source,
	)
	return err
}

// GetEncounterHistory returns paginated encounter events for a Pokemon.
func (d *DB) GetEncounterHistory(pokemonID string, limit, offset int) ([]EncounterEvent, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := d.db.Query(
		`SELECT id, pokemon_id, pokemon_name, timestamp, delta, count_after, source
		 FROM encounter_events WHERE pokemon_id = ?
		 ORDER BY id DESC LIMIT ? OFFSET ?`,
		pokemonID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var events []EncounterEvent
	for rows.Next() {
		var e EncounterEvent
		if err := rows.Scan(&e.ID, &e.PokemonID, &e.PokemonName, &e.Timestamp, &e.Delta, &e.CountAfter, &e.Source); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	if events == nil {
		events = []EncounterEvent{}
	}
	return events, rows.Err()
}

// GetEncounterStats returns aggregated stats for a Pokemon.
func (d *DB) GetEncounterStats(pokemonID string) (*EncounterStats, error) {
	stats := &EncounterStats{}

	// Total encounters (increments minus decrements)
	err := d.db.QueryRow(
		`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE pokemon_id = ?`,
		pokemonID,
	).Scan(&stats.Total)
	if err != nil {
		return nil, err
	}

	// Today's encounters (increments minus decrements)
	todayStart := time.Now().UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
	err = d.db.QueryRow(
		`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE pokemon_id = ? AND timestamp >= ?`,
		pokemonID, todayStart,
	).Scan(&stats.Today)
	if err != nil {
		return nil, err
	}

	// First and last timestamps
	_ = d.db.QueryRow(
		`SELECT MIN(timestamp), MAX(timestamp) FROM encounter_events WHERE pokemon_id = ? AND delta > 0`,
		pokemonID,
	).Scan(&stats.FirstAt, &stats.LastAt)

	// Clamp negative totals to zero (more decrements than increments).
	if stats.Total < 0 {
		stats.Total = 0
	}
	if stats.Today < 0 {
		stats.Today = 0
	}

	// Rate per hour
	if stats.FirstAt != "" && stats.LastAt != "" && stats.Total > 0 {
		first, _ := time.Parse(time.RFC3339, stats.FirstAt)
		last, _ := time.Parse(time.RFC3339, stats.LastAt)
		hours := last.Sub(first).Hours()
		if hours > 0 {
			stats.RatePerHour = float64(stats.Total) / hours
		}
	}

	return stats, nil
}

// GetChartData returns encounter counts grouped by interval.
func (d *DB) GetChartData(pokemonID, interval string) ([]ChartPoint, error) {
	var groupExpr, limitDays string
	switch interval {
	case "hour":
		groupExpr = "strftime('%Y-%m-%d %H:00', timestamp)"
		limitDays = "7"
	case "week":
		groupExpr = "strftime('%Y-W%W', timestamp)"
		limitDays = "365"
	default: // "day"
		groupExpr = "strftime('%Y-%m-%d', timestamp)"
		limitDays = "90"
	}

	cutoff := time.Now().UTC().AddDate(0, 0, -mustAtoi(limitDays)).Format(time.RFC3339)
	rows, err := d.db.Query(
		fmt.Sprintf(
			`SELECT %s AS label, MAX(COALESCE(SUM(delta), 0), 0) AS cnt
			 FROM encounter_events
			 WHERE pokemon_id = ? AND timestamp >= ?
			 GROUP BY label ORDER BY label`, groupExpr),
		pokemonID, cutoff,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var points []ChartPoint
	for rows.Next() {
		var p ChartPoint
		if err := rows.Scan(&p.Label, &p.Count); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	if points == nil {
		points = []ChartPoint{}
	}
	return points, rows.Err()
}

// GetOverviewStats returns global statistics.
func (d *DB) GetOverviewStats() (*OverviewStats, error) {
	stats := &OverviewStats{}
	_ = d.db.QueryRow(`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE delta > 0`).Scan(&stats.TotalEncounters)
	_ = d.db.QueryRow(`SELECT COUNT(DISTINCT pokemon_id) FROM encounter_events`).Scan(&stats.TotalPokemon)
	todayStart := time.Now().UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
	_ = d.db.QueryRow(`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE delta > 0 AND timestamp >= ?`, todayStart).Scan(&stats.Today)
	return stats, nil
}

// StartTimerSession records a new timer session start.
func (d *DB) StartTimerSession(pokemonID string) (int64, error) {
	res, err := d.db.Exec(
		`INSERT INTO timer_sessions (pokemon_id, started_at) VALUES (?, ?)`,
		pokemonID, time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// EndTimerSession records the end of a timer session.
func (d *DB) EndTimerSession(sessionID int64, encountersDuring int) error {
	_, err := d.db.Exec(
		`UPDATE timer_sessions SET ended_at = ?, encounters_during = ? WHERE id = ?`,
		time.Now().UTC().Format(time.RFC3339), encountersDuring, sessionID,
	)
	return err
}

// GetTimerSessions returns all timer sessions for a Pokemon.
func (d *DB) GetTimerSessions(pokemonID string) ([]TimerSession, error) {
	rows, err := d.db.Query(
		`SELECT id, pokemon_id, started_at, COALESCE(ended_at, ''), encounters_during
		 FROM timer_sessions WHERE pokemon_id = ? ORDER BY id DESC`,
		pokemonID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var sessions []TimerSession
	for rows.Next() {
		var s TimerSession
		if err := rows.Scan(&s.ID, &s.PokemonID, &s.StartedAt, &s.EndedAt, &s.EncountersDuring); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []TimerSession{}
	}
	return sessions, rows.Err()
}

// SaveGames replaces all rows in the games table within a transaction.
func (d *DB) SaveGames(rows []GameRow) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM games`); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO games (key, names, generation, platform) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()
	for _, r := range rows {
		if _, err := stmt.Exec(r.Key, string(r.NamesJSON), r.Generation, r.Platform); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// LoadGames returns all game rows from the database, or nil if the table is empty.
func (d *DB) LoadGames() ([]GameRow, error) {
	rows, err := d.db.Query(`SELECT key, names, generation, platform FROM games ORDER BY generation, key`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []GameRow
	for rows.Next() {
		var r GameRow
		var names string
		if err := rows.Scan(&r.Key, &names, &r.Generation, &r.Platform); err != nil {
			return nil, err
		}
		r.NamesJSON = []byte(names)
		result = append(result, r)
	}
	return result, rows.Err()
}

// HasGames reports whether the games table contains any rows.
func (d *DB) HasGames() bool {
	var n int
	_ = d.db.QueryRow(`SELECT 1 FROM games LIMIT 1`).Scan(&n)
	return n == 1
}

// PokedexSpeciesRow represents one species in the pokedex_species table.
type PokedexSpeciesRow struct {
	ID            int
	Canonical     string
	NamesJSON     []byte
	GenderRate    int
	EvolvesFromID int
	GamesJSON     []byte
}

// PokedexFormRow represents one alternate form in the pokedex_forms table.
// SpriteSlug carries the name-based sprite identifier for cosmetic forms
// without a dedicated PokéAPI pokemon entry; it is empty for regular forms.
// Gender restricts the form to a single gender's appearance ("male" or
// "female"); it is empty when the form does not depend on gender.
type PokedexFormRow struct {
	SpeciesID       int
	Canonical       string
	SpriteID        int
	SpriteSlug      string
	NamesJSON       []byte
	FormNamesJSON   []byte
	GenerationsJSON []byte
	Gender          string
}

// SavePokedex replaces all rows in the pokedex tables within a transaction.
func (d *DB) SavePokedex(species []PokedexSpeciesRow, forms []PokedexFormRow) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Delete child table first to respect foreign key constraints.
	if _, err := tx.Exec(`DELETE FROM pokedex_forms`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM pokedex_species`); err != nil {
		return err
	}

	speciesStmt, err := tx.Prepare(`INSERT INTO pokedex_species (id, canonical, names_json, gender_rate, evolves_from_id, games_json) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = speciesStmt.Close() }()
	for _, s := range species {
		if _, err := speciesStmt.Exec(s.ID, s.Canonical, string(s.NamesJSON), s.GenderRate, s.EvolvesFromID, string(s.GamesJSON)); err != nil {
			return err
		}
	}

	formStmt, err := tx.Prepare(`INSERT INTO pokedex_forms (species_id, canonical, sprite_id, sprite_slug, names_json, form_names_json, generations, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = formStmt.Close() }()
	for _, f := range forms {
		gens := f.GenerationsJSON
		if len(gens) == 0 {
			gens = []byte("[]")
		}
		formNamesStr := string(f.FormNamesJSON)
		if formNamesStr == "" {
			formNamesStr = "{}"
		}
		if _, err := formStmt.Exec(f.SpeciesID, f.Canonical, f.SpriteID, f.SpriteSlug, string(f.NamesJSON), formNamesStr, string(gens), f.Gender); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// LoadPokedex returns all species and form rows from the database.
func (d *DB) LoadPokedex() ([]PokedexSpeciesRow, []PokedexFormRow, error) {
	speciesRows, err := d.db.Query(`SELECT id, canonical, names_json, gender_rate, evolves_from_id, games_json FROM pokedex_species ORDER BY id`)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = speciesRows.Close() }()
	var species []PokedexSpeciesRow
	for speciesRows.Next() {
		var s PokedexSpeciesRow
		var names, games string
		if err := speciesRows.Scan(&s.ID, &s.Canonical, &names, &s.GenderRate, &s.EvolvesFromID, &games); err != nil {
			return nil, nil, err
		}
		s.NamesJSON = []byte(names)
		s.GamesJSON = []byte(games)
		species = append(species, s)
	}
	if err := speciesRows.Err(); err != nil {
		return nil, nil, err
	}

	formRows, err := d.db.Query(`SELECT species_id, canonical, sprite_id, sprite_slug, names_json, form_names_json, generations, gender FROM pokedex_forms ORDER BY species_id, id`)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = formRows.Close() }()
	var forms []PokedexFormRow
	for formRows.Next() {
		var f PokedexFormRow
		var names, formNames, gens string
		if err := formRows.Scan(&f.SpeciesID, &f.Canonical, &f.SpriteID, &f.SpriteSlug, &names, &formNames, &gens, &f.Gender); err != nil {
			return nil, nil, err
		}
		f.NamesJSON = []byte(names)
		f.FormNamesJSON = []byte(formNames)
		f.GenerationsJSON = []byte(gens)
		forms = append(forms, f)
	}
	if err := formRows.Err(); err != nil {
		return nil, nil, err
	}

	return species, forms, nil
}

// HasPokedex reports whether the pokedex_species table contains any rows.
func (d *DB) HasPokedex() bool {
	var n int
	_ = d.db.QueryRow(`SELECT 1 FROM pokedex_species LIMIT 1`).Scan(&n)
	return n == 1
}

// PokedexCount returns the number of species in the pokedex_species table.
func (d *DB) PokedexCount() int {
	var n int
	_ = d.db.QueryRow(`SELECT COUNT(*) FROM pokedex_species`).Scan(&n)
	return n
}

// PokedexOverrideRow represents one manual Pokédex caught/seen override in
// the pokedex_overrides table. FormCanonical empty means the override applies
// at the species level (no form restriction); Gender empty means it is not
// gender-restricted; Game empty means it is global (counts everywhere).
// MetaJSON holds the optional catch metadata (state.CatchMeta) as a JSON
// string, with "{}" meaning nothing recorded.
type PokedexOverrideRow struct {
	ID            int64
	PokedexID     string
	SpeciesID     int
	FormCanonical string
	Gender        string
	Game          string
	Caught        bool
	Seen          bool
	CreatedAt     string
	UpdatedAt     string
	MetaJSON      string
}

// ListPokedexOverrides returns all manual Pokédex caught/seen overrides.
func (d *DB) ListPokedexOverrides() ([]PokedexOverrideRow, error) {
	rows, err := d.db.Query(`SELECT id, pokedex_id, species_id, form_canonical, gender, game, caught, seen, created_at, updated_at, meta_json
		FROM pokedex_overrides ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var result []PokedexOverrideRow
	for rows.Next() {
		var r PokedexOverrideRow
		var caught, seen int
		if err := rows.Scan(&r.ID, &r.PokedexID, &r.SpeciesID, &r.FormCanonical, &r.Gender, &r.Game, &caught, &seen, &r.CreatedAt, &r.UpdatedAt, &r.MetaJSON); err != nil {
			return nil, err
		}
		r.Caught = caught != 0
		r.Seen = seen != 0
		result = append(result, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if result == nil {
		result = []PokedexOverrideRow{}
	}
	return result, nil
}

// UpsertPokedexOverride creates or updates the manual Pokédex override
// identified by (SpeciesID, FormCanonical, Gender, Game). When row has both
// Caught and Seen false, the matching row is deleted instead of being stored
// with all-false flags; the second return value reports whether a deletion
// happened. CreatedAt/UpdatedAt on the input row are ignored; this method
// stamps them itself. MetaJSON is written as given, so a caller that wants to
// preserve the previously stored metadata must resolve it to the existing
// value itself before calling; this method has no notion of "unchanged". On a
// successful upsert the returned row is read back from the database so the
// caller sees the final ID and timestamps.
func (d *DB) UpsertPokedexOverride(row PokedexOverrideRow) (PokedexOverrideRow, bool, error) {
	if row.PokedexID == "" {
		row.PokedexID = "default"
	}
	if row.ID != 0 {
		return d.movePokedexOverride(row)
	}
	if !row.Caught && !row.Seen {
		if _, err := d.db.Exec(
			`DELETE FROM pokedex_overrides WHERE pokedex_id = ? AND species_id = ? AND form_canonical = ? AND gender = ? AND game = ?`,
			row.PokedexID, row.SpeciesID, row.FormCanonical, row.Gender, row.Game,
		); err != nil {
			return PokedexOverrideRow{}, false, fmt.Errorf("delete pokedex override: %w", err)
		}
		return PokedexOverrideRow{}, true, nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := d.db.Exec(
		`INSERT INTO pokedex_overrides (pokedex_id, species_id, form_canonical, gender, game, caught, seen, created_at, updated_at, meta_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(pokedex_id, species_id, form_canonical, gender, game) DO UPDATE SET
			caught     = excluded.caught,
			seen       = excluded.seen,
			updated_at = excluded.updated_at,
			meta_json  = excluded.meta_json`,
		row.PokedexID, row.SpeciesID, row.FormCanonical, row.Gender, row.Game, boolToInt(row.Caught), boolToInt(row.Seen), now, now, row.MetaJSON,
	); err != nil {
		return PokedexOverrideRow{}, false, fmt.Errorf("upsert pokedex override: %w", err)
	}

	var out PokedexOverrideRow
	var caught, seen int
	err := d.db.QueryRow(
		`SELECT id, pokedex_id, species_id, form_canonical, gender, game, caught, seen, created_at, updated_at, meta_json
		 FROM pokedex_overrides WHERE pokedex_id = ? AND species_id = ? AND form_canonical = ? AND gender = ? AND game = ?`,
		row.PokedexID, row.SpeciesID, row.FormCanonical, row.Gender, row.Game,
	).Scan(&out.ID, &out.PokedexID, &out.SpeciesID, &out.FormCanonical, &out.Gender, &out.Game, &caught, &seen, &out.CreatedAt, &out.UpdatedAt, &out.MetaJSON)
	if err != nil {
		return PokedexOverrideRow{}, false, fmt.Errorf("read back pokedex override: %w", err)
	}
	out.Caught = caught != 0
	out.Seen = seen != 0
	return out, false, nil
}

func (d *DB) movePokedexOverride(row PokedexOverrideRow) (PokedexOverrideRow, bool, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return PokedexOverrideRow{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if !row.Caught && !row.Seen {
		res, err := tx.Exec(`DELETE FROM pokedex_overrides WHERE id = ?`, row.ID)
		if err != nil {
			return PokedexOverrideRow{}, false, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return PokedexOverrideRow{}, false, sql.ErrNoRows
		}
		if err := tx.Commit(); err != nil {
			return PokedexOverrideRow{}, false, err
		}
		return PokedexOverrideRow{}, true, nil
	}
	var occupied int64
	err = tx.QueryRow(`SELECT id FROM pokedex_overrides WHERE pokedex_id=? AND species_id=? AND form_canonical=? AND gender=? AND game=? AND id<>?`, row.PokedexID, row.SpeciesID, row.FormCanonical, row.Gender, row.Game, row.ID).Scan(&occupied)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return PokedexOverrideRow{}, false, err
	}
	if err == nil {
		return PokedexOverrideRow{}, false, ErrPokedexOverrideConflict
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := tx.Exec(`UPDATE pokedex_overrides SET pokedex_id=?, species_id=?, form_canonical=?, gender=?, game=?, caught=?, seen=?, updated_at=?, meta_json=? WHERE id=?`, row.PokedexID, row.SpeciesID, row.FormCanonical, row.Gender, row.Game, boolToInt(row.Caught), boolToInt(row.Seen), now, row.MetaJSON, row.ID)
	if err != nil {
		return PokedexOverrideRow{}, false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return PokedexOverrideRow{}, false, sql.ErrNoRows
	}
	var out PokedexOverrideRow
	var caught, seen int
	err = tx.QueryRow(`SELECT id,pokedex_id,species_id,form_canonical,gender,game,caught,seen,created_at,updated_at,meta_json FROM pokedex_overrides WHERE id=?`, row.ID).Scan(&out.ID, &out.PokedexID, &out.SpeciesID, &out.FormCanonical, &out.Gender, &out.Game, &caught, &seen, &out.CreatedAt, &out.UpdatedAt, &out.MetaJSON)
	if err != nil {
		return PokedexOverrideRow{}, false, err
	}
	out.Caught, out.Seen = caught != 0, seen != 0
	if err := tx.Commit(); err != nil {
		return PokedexOverrideRow{}, false, err
	}
	return out, false, nil
}

func mustAtoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}

// BackfillPokemonFormNames populates base_name and form_name on existing
// pokemon rows that have a canonical_name matching a pokedex form. It uses
// json_extract to pull the localized species name (base_name) and the form
// descriptor (form_name) from the pokedex tables. Only rows where both
// fields are still empty are updated, so user-edited values are preserved.
func (d *DB) BackfillPokemonFormNames() (int64, error) {
	res, err := d.db.Exec(`
		UPDATE pokemon
		SET
			base_name = COALESCE(
				json_extract(ps.names_json, '$.' || pokemon.language),
				json_extract(ps.names_json, '$.en'),
				''
			),
			form_name = COALESCE(
				json_extract(pf.form_names_json, '$.' || pokemon.language),
				json_extract(pf.form_names_json, '$.en'),
				''
			)
		FROM pokedex_forms pf
		JOIN pokedex_species ps ON pf.species_id = ps.id
		WHERE pokemon.canonical_name = pf.canonical
		  AND pokemon.base_name = ''
		  AND pokemon.form_name = ''
	`)
	if err != nil {
		return 0, fmt.Errorf("backfill pokemon form names: %w", err)
	}
	return res.RowsAffected()
}
