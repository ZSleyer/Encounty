// Package database provides SQLite-backed encounter and timer history.
// It uses modernc.org/sqlite (pure Go, no CGO) for cross-platform builds.
package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

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

// Open creates or opens a SQLite database at path and runs migrations.
func Open(path string) (*DB, error) {
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=journal_mode(wal)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	sqlDB.SetMaxOpenConns(1)

	d := &DB{db: sqlDB}
	if err := d.migrate(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

// Close closes the database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

func (d *DB) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS encounter_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pokemon_id TEXT NOT NULL,
			pokemon_name TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			delta INTEGER NOT NULL,
			count_after INTEGER NOT NULL,
			source TEXT DEFAULT 'manual'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_encounter_pokemon ON encounter_events(pokemon_id)`,
		`CREATE INDEX IF NOT EXISTS idx_encounter_ts ON encounter_events(timestamp)`,
		`CREATE TABLE IF NOT EXISTS timer_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pokemon_id TEXT NOT NULL,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			encounters_during INTEGER DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_timer_pokemon ON timer_sessions(pokemon_id)`,
	}
	for _, s := range stmts {
		if _, err := d.db.Exec(s); err != nil {
			return fmt.Errorf("exec %q: %w", s[:40], err)
		}
	}
	return nil
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
	defer rows.Close()
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

	// Total positive encounters
	err := d.db.QueryRow(
		`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE pokemon_id = ? AND delta > 0`,
		pokemonID,
	).Scan(&stats.Total)
	if err != nil {
		return nil, err
	}

	// Today's encounters
	todayStart := time.Now().UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
	err = d.db.QueryRow(
		`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE pokemon_id = ? AND delta > 0 AND timestamp >= ?`,
		pokemonID, todayStart,
	).Scan(&stats.Today)
	if err != nil {
		return nil, err
	}

	// First and last timestamps
	d.db.QueryRow(
		`SELECT MIN(timestamp), MAX(timestamp) FROM encounter_events WHERE pokemon_id = ? AND delta > 0`,
		pokemonID,
	).Scan(&stats.FirstAt, &stats.LastAt)

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
			`SELECT %s AS label, COALESCE(SUM(delta), 0) AS cnt
			 FROM encounter_events
			 WHERE pokemon_id = ? AND delta > 0 AND timestamp >= ?
			 GROUP BY label ORDER BY label`, groupExpr),
		pokemonID, cutoff,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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
	d.db.QueryRow(`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE delta > 0`).Scan(&stats.TotalEncounters)
	d.db.QueryRow(`SELECT COUNT(DISTINCT pokemon_id) FROM encounter_events`).Scan(&stats.TotalPokemon)
	todayStart := time.Now().UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
	d.db.QueryRow(`SELECT COALESCE(SUM(delta), 0) FROM encounter_events WHERE delta > 0 AND timestamp >= ?`, todayStart).Scan(&stats.Today)
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
	defer rows.Close()
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

func mustAtoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}
