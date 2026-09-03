// state_load.go reconstructs a full AppState from the normalized v2 schema.
// It reads every table (app_config, hotkeys, settings, pokemon, sessions, etc.)
// and assembles them into a single state.AppState value. Child tables are read
// with one batched query per table (keyed by owner id) and assembled in memory,
// avoiding the O(pokemon x elements) per-parent query fan-out that would
// otherwise serialize behind MaxOpenConns(1) on startup.
package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// HasState reports whether the normalized schema contains an app_config row.
func (d *DB) HasState() bool {
	var n int
	_ = d.db.QueryRow(`SELECT 1 FROM app_config WHERE id = 1`).Scan(&n)
	return n == 1
}

// LoadFullState reads all normalized tables and assembles a complete AppState.
// Returns nil (without error) when no app_config row exists yet.
func (d *DB) LoadFullState() (*state.AppState, error) {
	// 1. Check for app_config row.
	var activeID string
	var licenseAccepted int
	err := d.db.QueryRow(`SELECT active_id, license_accepted FROM app_config WHERE id = 1`).
		Scan(&activeID, &licenseAccepted)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load app_config: %w", err)
	}

	st := &state.AppState{
		ActiveID:        activeID,
		LicenseAccepted: licenseAccepted != 0,
		Pokemon:         []state.Pokemon{},
		Sessions:        []state.Session{},
	}

	// 2. Load singleton rows (hotkeys, settings, languages).
	if err := loadSingletonRows(d.db, st); err != nil {
		return nil, err
	}

	// 3. Load every overlay (global + per-pokemon) in one batched pass and
	//    assign the global overlay to the settings.
	overlays, err := loadAllOverlays(d.db)
	if err != nil {
		return nil, fmt.Errorf("load overlays: %w", err)
	}
	if global := overlays[overlayKey("global", "default")]; global != nil {
		st.Settings.Overlay = *global
	}

	// 4. Load all pokemon rows and attach custom overlays from the map.
	st.Pokemon, err = loadPokemon(d.db)
	if err != nil {
		return nil, fmt.Errorf("load pokemon: %w", err)
	}
	for i := range st.Pokemon {
		if st.Pokemon[i].OverlayMode == "custom" {
			st.Pokemon[i].Overlay = overlays[overlayKey("pokemon", st.Pokemon[i].ID)]
		}
	}

	// 4a. Attach detector configs, templates, regions, and logs in batched passes.
	if err := attachDetectors(d.db, st.Pokemon); err != nil {
		return nil, err
	}

	// 4b. Load per-Pokémon tags and attach them to the loaded Pokémon.
	if err := attachPokemonTags(d.db, st.Pokemon); err != nil {
		return nil, fmt.Errorf("load pokemon tags: %w", err)
	}
	if err := attachPokemonPokedexes(d.db, st.Pokemon); err != nil {
		return nil, fmt.Errorf("load pokedex memberships: %w", err)
	}

	// 4b2. Load per-Pokémon phase targets and attach them.
	if err := attachPhaseTargets(d.db, st.Pokemon); err != nil {
		return nil, fmt.Errorf("load phase targets: %w", err)
	}

	// 4c. Load organizational groups.
	st.Groups, err = loadGroups(d.db)
	if err != nil {
		return nil, fmt.Errorf("load groups: %w", err)
	}

	// 5. Load sessions.
	st.Sessions, err = loadSessions(d.db)
	if err != nil {
		return nil, fmt.Errorf("load sessions: %w", err)
	}

	return st, nil
}

func attachPokemonPokedexes(db *sql.DB, pokemon []state.Pokemon) error {
	byID := make(map[string]*state.Pokemon, len(pokemon))
	for i := range pokemon {
		pokemon[i].PokedexIDs = []string{}
		byID[pokemon[i].ID] = &pokemon[i]
	}
	return eachRow(db, `SELECT pokemon_id, pokedex_id FROM pokedex_pokemon ORDER BY pokedex_id`, nil, func(rows *sql.Rows) error {
		var pokemonID, pokedexID string
		if err := rows.Scan(&pokemonID, &pokedexID); err != nil {
			return err
		}
		if p := byID[pokemonID]; p != nil {
			p.PokedexIDs = append(p.PokedexIDs, pokedexID)
		}
		return nil
	})
}

// loadGroups reads every pokemon_groups row ordered by sort_order, then id
// so the frontend receives a stable, user-controlled ordering.
func loadGroups(db *sql.DB) ([]state.Group, error) {
	groups := []state.Group{}
	err := eachRow(db, `SELECT id, name, color, sort_order, collapsed FROM pokemon_groups ORDER BY sort_order, id`, nil, func(rows *sql.Rows) error {
		var g state.Group
		var collapsed int
		if err := rows.Scan(&g.ID, &g.Name, &g.Color, &g.SortOrder, &collapsed); err != nil {
			return err
		}
		g.Collapsed = collapsed != 0
		groups = append(groups, g)
		return nil
	})
	return groups, err
}

// attachPokemonTags fills Pokemon.Tags for every entry in pokemon by reading
// pokemon_tags in a single query. Pokémon without tag rows end up with a
// non-nil empty slice so JSON serialization emits [] rather than null.
func attachPokemonTags(db *sql.DB, pokemon []state.Pokemon) error {
	for i := range pokemon {
		pokemon[i].Tags = []string{}
	}
	idx := make(map[string]int, len(pokemon))
	for i, p := range pokemon {
		idx[p.ID] = i
	}
	return eachRow(db, `SELECT pokemon_id, tag FROM pokemon_tags ORDER BY pokemon_id, tag`, nil, func(rows *sql.Rows) error {
		var pokemonID, tag string
		if err := rows.Scan(&pokemonID, &tag); err != nil {
			return err
		}
		if i, ok := idx[pokemonID]; ok {
			pokemon[i].Tags = append(pokemon[i].Tags, tag)
		}
		return nil
	})
}

// attachPhaseTargets fills Pokemon.PhaseTargets for every entry in pokemon by
// reading phase_targets in a single query. Pokémon without target rows end up
// with a non-nil empty slice so JSON serialization emits [] rather than null.
func attachPhaseTargets(db *sql.DB, pokemon []state.Pokemon) error {
	for i := range pokemon {
		pokemon[i].PhaseTargets = []state.PhaseTarget{}
	}
	idx := make(map[string]int, len(pokemon))
	for i, p := range pokemon {
		idx[p.ID] = i
	}
	return eachRow(db, `SELECT pokemon_id, canonical_name, name, sprite_url, gender
		FROM phase_targets ORDER BY pokemon_id, sort_order, canonical_name`, nil, func(rows *sql.Rows) error {
		var pokemonID string
		var target state.PhaseTarget
		if err := rows.Scan(&pokemonID, &target.CanonicalName, &target.Name, &target.SpriteURL, &target.Gender); err != nil {
			return err
		}
		if i, ok := idx[pokemonID]; ok {
			pokemon[i].PhaseTargets = append(pokemon[i].PhaseTargets, target)
		}
		return nil
	})
}

// loadSingletonRows populates hotkeys and settings on the given AppState. The
// overlay is loaded separately via loadAllOverlays.
func loadSingletonRows(db *sql.DB, st *state.AppState) error {
	var err error
	st.Hotkeys, err = loadHotkeys(db)
	if err != nil {
		return fmt.Errorf("load hotkeys: %w", err)
	}
	st.Settings, err = loadSettings(db)
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}
	st.Settings.CaptureResolutions, err = loadCaptureResolutions(db)
	if err != nil {
		return fmt.Errorf("load capture resolutions: %w", err)
	}
	return nil
}

// loadHotkeys reads the singleton hotkeys row.
func loadHotkeys(db *sql.DB) (state.HotkeyMap, error) {
	var h state.HotkeyMap
	err := db.QueryRow(`SELECT increment, decrement, reset, next_pokemon, hunt_toggle FROM hotkeys WHERE id = 1`).
		Scan(&h.Increment, &h.Decrement, &h.Reset, &h.NextPokemon, &h.HuntToggle)
	if err == sql.ErrNoRows {
		return h, nil
	}
	return h, err
}

// loadSettings reads the singleton settings row including inline tutorial flags.
func loadSettings(db *sql.DB) (state.Settings, error) {
	var s state.Settings
	var outputEnabled, autoSave, crispSprites, tutOverlay, tutDetection int
	err := db.QueryRow(`SELECT output_enabled, output_dir, auto_save,
		crisp_sprites, accent_color, tutorial_overlay_editor, tutorial_auto_detection
		FROM settings WHERE id = 1`).
		Scan(&outputEnabled, &s.OutputDir, &autoSave,
			&crispSprites, &s.AccentColor, &tutOverlay, &tutDetection)
	if err == sql.ErrNoRows {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	s.OutputEnabled = outputEnabled != 0
	s.AutoSave = autoSave != 0
	s.CrispSprites = crispSprites != 0
	if s.AccentColor == "" {
		s.AccentColor = "violet"
	}
	s.TutorialSeen.OverlayEditor = tutOverlay != 0
	s.TutorialSeen.AutoDetection = tutDetection != 0
	return s, nil
}

// loadCaptureResolutions reads the per-device capture resolution map. Returns a
// non-nil (possibly empty) map so the broadcast never emits null.
func loadCaptureResolutions(db *sql.DB) (map[string]string, error) {
	resolutions := map[string]string{}
	err := eachRow(db, `SELECT device_key, resolution FROM capture_resolutions`, nil, func(rows *sql.Rows) error {
		var deviceKey, resolution string
		if err := rows.Scan(&deviceKey, &resolution); err != nil {
			return err
		}
		resolutions[deviceKey] = resolution
		return nil
	})
	return resolutions, err
}

// loadPokemon reads all pokemon rows ordered by sort_order.
func loadPokemon(db *sql.DB) ([]state.Pokemon, error) {
	var pokemon []state.Pokemon
	err := eachRow(db, `SELECT id, name, base_name, form_name, nickname, title, canonical_name, gender, sprite_url, sprite_type,
		sprite_style, encounters, step, is_active, created_at, language, game,
		completed_at, overlay_mode, hunt_type, shiny_charm, sparkling_power, shiny_variant, entry_source, timer_started_at, timer_accumulated_ms,
		hunt_mode, group_id, phase_of, phase_number, catch_meta, failed
		FROM pokemon ORDER BY sort_order`, nil, func(rows *sql.Rows) error {
		var p state.Pokemon
		var isActive int
		var shinyCharm int
		var failed int
		var createdAtStr string
		var catchMetaJSON string
		var completedAt, timerStartedAt sql.NullString

		if err := rows.Scan(&p.ID, &p.Name, &p.BaseName, &p.FormName, &p.Nickname, &p.Title, &p.CanonicalName, &p.Gender, &p.SpriteURL,
			&p.SpriteType, &p.SpriteStyle, &p.Encounters, &p.Step, &isActive,
			&createdAtStr, &p.Language, &p.Game, &completedAt, &p.OverlayMode,
			&p.HuntType, &shinyCharm, &p.SparklingPower, &p.ShinyVariant, &p.EntrySource, &timerStartedAt, &p.TimerAccumulatedMs, &p.HuntMode, &p.GroupID,
			&p.PhaseOf, &p.PhaseNumber, &catchMetaJSON, &failed); err != nil {
			return err
		}
		p.Catch = unmarshalCatchMeta(catchMetaJSON)
		p.IsActive = isActive != 0
		p.ShinyCharm = shinyCharm != 0
		p.Failed = failed != 0
		if t, err := time.Parse(time.RFC3339, createdAtStr); err == nil {
			p.CreatedAt = t
		}
		p.CompletedAt = parseOptionalTime(completedAt)
		p.TimerStartedAt = parseOptionalTime(timerStartedAt)
		// Ensure Tags and PhaseTargets are always non-nil slices;
		// attachPokemonTags and attachPhaseTargets fill them from their tables
		// once all rows are loaded.
		p.Tags = []string{}
		p.PhaseTargets = []state.PhaseTarget{}
		pokemon = append(pokemon, p)
		return nil
	})
	if pokemon == nil {
		pokemon = []state.Pokemon{}
	}
	return pokemon, err
}

// unmarshalCatchMeta decodes the JSON blob stored in pokemon.catch_meta.
// An empty column means "nothing recorded" and a malformed one is treated the
// same way: an unreadable optional note must never keep the application from
// starting.
func unmarshalCatchMeta(raw string) *state.CatchMeta {
	if raw == "" {
		return nil
	}
	var meta state.CatchMeta
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		slog.Warn("Discarding unreadable catch metadata", "error", err)
		return nil
	}
	if meta.Ribbons == nil {
		meta.Ribbons = []string{}
	}
	return &meta
}

// loadSessions reads all session records.
func loadSessions(db *sql.DB) ([]state.Session, error) {
	var sessions []state.Session
	err := eachRow(db, `SELECT id, pokemon_id, started_at, ended_at, encounters FROM sessions`, nil, func(rows *sql.Rows) error {
		var s state.Session
		var startedAtStr string
		var endedAt sql.NullString
		if err := rows.Scan(&s.ID, &s.PokemonID, &startedAtStr, &endedAt, &s.Encounters); err != nil {
			return err
		}
		if t, err := time.Parse(time.RFC3339, startedAtStr); err == nil {
			s.StartedAt = t
		}
		if endedAt.Valid && endedAt.String != "" {
			if t, err := time.Parse(time.RFC3339, endedAt.String); err == nil {
				s.EndedAt = &t
			}
		}
		sessions = append(sessions, s)
		return nil
	})
	if sessions == nil {
		sessions = []state.Session{}
	}
	return sessions, err
}

// parseOptionalTime parses a nullable RFC3339 string into a *time.Time.
func parseOptionalTime(ns sql.NullString) *time.Time {
	if ns.Valid && ns.String != "" {
		if t, err := time.Parse(time.RFC3339, ns.String); err == nil {
			return &t
		}
	}
	return nil
}
