// state_save.go implements SaveFullState, which persists the entire AppState
// to the normalized v2 schema tables within a single SQLite transaction.
package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// SaveFullState writes every field of st into the normalized v2 tables inside
// one SQLite transaction, so a crash mid-save never leaves partial data.
func (d *DB) SaveFullState(st *state.AppState) error {
	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC().Format(time.RFC3339)

	// ── 1. app_config (singleton) ───────────────────────────────────────
	if _, err := tx.Exec(`
		INSERT INTO app_config (id, active_id, license_accepted, updated_at)
		VALUES (1, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			active_id        = excluded.active_id,
			license_accepted = excluded.license_accepted,
			updated_at       = excluded.updated_at`,
		st.ActiveID, boolToInt(st.LicenseAccepted), now,
	); err != nil {
		return fmt.Errorf("upsert app_config: %w", err)
	}

	// ── 2. hotkeys ──────────────────────────────────────────────────────
	if err := saveHotkeyRow(tx, &st.Hotkeys); err != nil {
		return err
	}

	// ── 3. settings + languages ─────────────────────────────────────────
	if err := saveSettingsRow(tx, &st.Settings); err != nil {
		return err
	}
	if err := saveLanguages(tx, st.Settings.Languages); err != nil {
		return err
	}
	if err := saveCaptureResolutions(tx, st.Settings.CaptureResolutions); err != nil {
		return err
	}

	// ── 4. Global overlay ───────────────────────────────────────────────
	if err := saveOverlay(tx, &st.Settings.Overlay, "global", "default"); err != nil {
		return fmt.Errorf("save global overlay: %w", err)
	}

	// ── 5. pokemon rows + per-pokemon overlays + detector configs ───────
	pokemonIDs := make([]string, len(st.Pokemon))
	for i, p := range st.Pokemon {
		pokemonIDs[i] = p.ID
	}
	if err := savePokemonRows(tx, st.Pokemon, pokemonIDs); err != nil {
		return err
	}
	if err := savePokemonPokedexes(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save pokedex memberships: %w", err)
	}
	// Runs after savePokemonRows because the rows it references must exist for
	// the foreign key on phase_targets.pokemon_id.
	if err := savePhaseTargets(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save phase_targets: %w", err)
	}
	if err := savePokemonOverlays(tx, st.Pokemon, pokemonIDs); err != nil {
		return err
	}
	if err := saveDetectorConfigs(tx, st.Pokemon, pokemonIDs); err != nil {
		return err
	}

	// ── 6. detector_templates, template_regions, detection_log ──────────
	if err := saveDetectorTemplates(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save detector_templates: %w", err)
	}
	if err := saveTemplateRegions(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save template_regions: %w", err)
	}
	if err := saveDetectionLogs(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save detection_log: %w", err)
	}

	// ── 7. sessions ─────────────────────────────────────────────────────
	if err := saveSessions(tx, st.Sessions); err != nil {
		return err
	}

	// ── 8. groups + pokemon_tags ────────────────────────────────────────
	if err := saveGroups(tx, st.Groups); err != nil {
		return fmt.Errorf("save groups: %w", err)
	}
	if err := savePokemonTags(tx, st.Pokemon); err != nil {
		return fmt.Errorf("save pokemon_tags: %w", err)
	}

	return tx.Commit()
}

func savePokemonPokedexes(tx *sql.Tx, pokemon []state.Pokemon) error {
	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO pokedex_pokemon (pokedex_id, pokemon_id) VALUES (?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()
	for _, p := range pokemon {
		if _, err := tx.Exec(`DELETE FROM pokedex_pokemon WHERE pokemon_id = ?`, p.ID); err != nil {
			return err
		}
		ids := p.PokedexIDs
		if ids == nil {
			ids = []string{"default"}
		}
		for _, id := range ids {
			if _, err := stmt.Exec(id, p.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

// UpdatePokemonCounters writes only the encounter and timer columns for the
// given Pokémon rows inside one transaction. It is the fast persistence path
// for counter/timer-only mutations, avoiding the full-state rewrite performed
// by SaveFullState. Rows whose id no longer exists are left untouched.
func (d *DB) UpdatePokemonCounters(counters []state.PokemonCounters) error {
	if len(counters) == 0 {
		return nil
	}
	tx, err := d.db.Begin()
	if err != nil {
		return fmt.Errorf("begin counter tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.Prepare(`UPDATE pokemon SET encounters = ?, timer_started_at = ?, timer_accumulated_ms = ? WHERE id = ?`)
	if err != nil {
		return fmt.Errorf("prepare counter update: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for _, c := range counters {
		if _, err := stmt.Exec(c.Encounters, nullTimeStr(c.TimerStartedAt), c.TimerAccumulatedMs, c.ID); err != nil {
			return fmt.Errorf("update counters for %q: %w", c.ID, err)
		}
	}
	return tx.Commit()
}

// saveGroups replaces the pokemon_groups rows with the given slice. A full
// delete+insert is used because groups are a small set and this avoids having
// to track renames or reordering as diff operations.
func saveGroups(tx *sql.Tx, groups []state.Group) error {
	if _, err := tx.Exec(`DELETE FROM pokemon_groups`); err != nil {
		return fmt.Errorf("delete pokemon_groups: %w", err)
	}
	if len(groups) == 0 {
		return nil
	}
	stmt, err := tx.Prepare(`INSERT INTO pokemon_groups (id, name, color, sort_order, collapsed) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare pokemon_groups insert: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for _, g := range groups {
		if _, err := stmt.Exec(g.ID, g.Name, g.Color, g.SortOrder, boolToInt(g.Collapsed)); err != nil {
			return fmt.Errorf("insert group %q: %w", g.ID, err)
		}
	}
	return nil
}

// savePokemonTags replaces pokemon_tags rows per Pokémon. The full-replace
// strategy keeps the save path simple and avoids tracking individual tag
// edits; tag lists are short so the cost is negligible.
func savePokemonTags(tx *sql.Tx, pokemon []state.Pokemon) error {
	stmt, err := tx.Prepare(`INSERT INTO pokemon_tags (pokemon_id, tag) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare pokemon_tags insert: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for _, p := range pokemon {
		if _, err := tx.Exec(`DELETE FROM pokemon_tags WHERE pokemon_id = ?`, p.ID); err != nil {
			return fmt.Errorf("delete pokemon_tags for %q: %w", p.ID, err)
		}
		for _, tag := range p.Tags {
			if tag == "" {
				continue
			}
			if _, err := stmt.Exec(p.ID, tag); err != nil {
				return fmt.Errorf("insert tag %q on %q: %w", tag, p.ID, err)
			}
		}
	}
	return nil
}

// savePhaseTargets replaces the phase_targets rows per Pokémon, mirroring the
// full-replace strategy of savePokemonTags. The insert uses OR IGNORE because a
// duplicate canonical_name would violate the primary key and abort the whole
// transaction, taking every later save step with it. sort_order stores the slice
// index so the chip order stays stable across a round-trip.
func savePhaseTargets(tx *sql.Tx, pokemon []state.Pokemon) error {
	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO phase_targets
		(pokemon_id, canonical_name, name, sprite_url, gender, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare phase_targets insert: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for _, p := range pokemon {
		if _, err := tx.Exec(`DELETE FROM phase_targets WHERE pokemon_id = ?`, p.ID); err != nil {
			return fmt.Errorf("delete phase_targets for %q: %w", p.ID, err)
		}
		for i, target := range p.PhaseTargets {
			if target.CanonicalName == "" {
				continue
			}
			if _, err := stmt.Exec(p.ID, target.CanonicalName, target.Name, target.SpriteURL, target.Gender, i); err != nil {
				return fmt.Errorf("insert phase target %q on %q: %w", target.CanonicalName, p.ID, err)
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// SaveFullState extracted helpers
// ---------------------------------------------------------------------------

// saveHotkeyRow upserts the singleton hotkeys row.
func saveHotkeyRow(tx *sql.Tx, h *state.HotkeyMap) error {
	if _, err := tx.Exec(`
		INSERT INTO hotkeys (id, increment, decrement, reset, next_pokemon, hunt_toggle)
		VALUES (1, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			increment    = excluded.increment,
			decrement    = excluded.decrement,
			reset        = excluded.reset,
			next_pokemon = excluded.next_pokemon,
			hunt_toggle  = excluded.hunt_toggle`,
		h.Increment, h.Decrement, h.Reset, h.NextPokemon, h.HuntToggle,
	); err != nil {
		return fmt.Errorf("upsert hotkeys: %w", err)
	}
	return nil
}

// saveSettingsRow upserts the singleton settings row including tutorial flags.
func saveSettingsRow(tx *sql.Tx, s *state.Settings) error {
	if _, err := tx.Exec(`
		INSERT INTO settings (id, output_enabled, output_dir, auto_save,
			crisp_sprites, accent_color, tutorial_overlay_editor, tutorial_auto_detection)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			output_enabled          = excluded.output_enabled,
			output_dir              = excluded.output_dir,
			auto_save               = excluded.auto_save,
			crisp_sprites           = excluded.crisp_sprites,
			accent_color            = excluded.accent_color,
			tutorial_overlay_editor = excluded.tutorial_overlay_editor,
			tutorial_auto_detection = excluded.tutorial_auto_detection`,
		boolToInt(s.OutputEnabled), s.OutputDir,
		boolToInt(s.AutoSave),
		boolToInt(s.CrispSprites), s.AccentColor,
		boolToInt(s.TutorialSeen.OverlayEditor),
		boolToInt(s.TutorialSeen.AutoDetection),
	); err != nil {
		return fmt.Errorf("upsert settings: %w", err)
	}
	return nil
}

// saveLanguages replaces all settings_languages rows with the given ordered list.
func saveLanguages(tx *sql.Tx, languages []string) error {
	if _, err := tx.Exec(`DELETE FROM settings_languages`); err != nil {
		return fmt.Errorf("delete settings_languages: %w", err)
	}
	stmt, err := tx.Prepare(`INSERT INTO settings_languages (language, sort_order) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare settings_languages: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for i, lang := range languages {
		if _, err := stmt.Exec(lang, i); err != nil {
			return fmt.Errorf("insert language %q: %w", lang, err)
		}
	}
	return nil
}

// saveCaptureResolutions replaces the per-device capture resolution map.
func saveCaptureResolutions(tx *sql.Tx, resolutions map[string]string) error {
	if _, err := tx.Exec(`DELETE FROM capture_resolutions`); err != nil {
		return fmt.Errorf("delete capture_resolutions: %w", err)
	}
	stmt, err := tx.Prepare(`INSERT INTO capture_resolutions (device_key, resolution) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare capture_resolutions: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for deviceKey, resolution := range resolutions {
		if _, err := stmt.Exec(deviceKey, resolution); err != nil {
			return fmt.Errorf("insert capture resolution %q: %w", deviceKey, err)
		}
	}
	return nil
}

// savePokemonRows deletes removed pokemon and upserts all current ones.
func savePokemonRows(tx *sql.Tx, pokemon []state.Pokemon, pokemonIDs []string) error {
	if err := deleteNotIn(tx, "pokemon", "id", pokemonIDs); err != nil {
		return fmt.Errorf("delete removed pokemon: %w", err)
	}

	stmt, err := tx.Prepare(`
		INSERT INTO pokemon (id, name, base_name, form_name, nickname, title, canonical_name, gender, sprite_url, sprite_type,
			sprite_style, encounters, step, is_active, created_at, language, game,
			completed_at, overlay_mode, hunt_type, shiny_charm, sparkling_power, shiny_variant, entry_source, timer_started_at, timer_accumulated_ms,
			hunt_mode, group_id, phase_of, phase_number, sort_order, catch_meta, failed)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name                 = excluded.name,
			base_name            = excluded.base_name,
			form_name            = excluded.form_name,
			nickname             = excluded.nickname,
			title                = excluded.title,
			canonical_name       = excluded.canonical_name,
			gender               = excluded.gender,
			sprite_url           = excluded.sprite_url,
			sprite_type          = excluded.sprite_type,
			sprite_style         = excluded.sprite_style,
			encounters           = excluded.encounters,
			step                 = excluded.step,
			is_active            = excluded.is_active,
			created_at           = excluded.created_at,
			language             = excluded.language,
			game                 = excluded.game,
			completed_at         = excluded.completed_at,
			overlay_mode         = excluded.overlay_mode,
			hunt_type            = excluded.hunt_type,
			shiny_charm          = excluded.shiny_charm,
			sparkling_power      = excluded.sparkling_power,
			shiny_variant        = excluded.shiny_variant,
			entry_source         = excluded.entry_source,
			timer_started_at     = excluded.timer_started_at,
			timer_accumulated_ms = excluded.timer_accumulated_ms,
			hunt_mode            = excluded.hunt_mode,
			group_id             = excluded.group_id,
			phase_of             = excluded.phase_of,
			phase_number         = excluded.phase_number,
			sort_order           = excluded.sort_order,
			catch_meta           = excluded.catch_meta,
			failed               = excluded.failed`)
	if err != nil {
		return fmt.Errorf("prepare pokemon upsert: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for i, p := range pokemon {
		if _, err := stmt.Exec(
			p.ID, p.Name, p.BaseName, p.FormName, p.Nickname, p.Title, p.CanonicalName, p.Gender, p.SpriteURL, p.SpriteType,
			p.SpriteStyle, p.Encounters, p.Step, boolToInt(p.IsActive),
			p.CreatedAt.UTC().Format(time.RFC3339), p.Language, p.Game,
			nullTimeStr(p.CompletedAt), p.OverlayMode, p.HuntType, boolToInt(p.ShinyCharm), p.SparklingPower, p.ShinyVariant, p.EntrySource,
			nullTimeStr(p.TimerStartedAt), p.TimerAccumulatedMs, p.HuntMode, p.GroupID,
			p.PhaseOf, p.PhaseNumber, i, marshalCatchMeta(p.Catch), boolToInt(p.Failed),
		); err != nil {
			return fmt.Errorf("upsert pokemon %q: %w", p.ID, err)
		}
	}
	return nil
}

// marshalCatchMeta encodes the optional catch details into the string stored in
// pokemon.catch_meta, using "" for "nothing recorded". A value that cannot be
// encoded is dropped rather than failing the save: losing one optional note is
// preferable to rolling back the whole application state.
func marshalCatchMeta(meta *state.CatchMeta) string {
	if meta.IsEmpty() {
		return ""
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		slog.Error("Marshal catch metadata failed, dropping it", "error", err)
		return ""
	}
	return string(raw)
}

// savePokemonOverlays syncs per-pokemon overlay_settings, removing stale entries
// and persisting custom overlays.
func savePokemonOverlays(tx *sql.Tx, pokemon []state.Pokemon, pokemonIDs []string) error {
	for _, p := range pokemon {
		if p.Overlay == nil {
			if _, err := tx.Exec(
				`DELETE FROM overlay_settings WHERE owner_type = 'pokemon' AND owner_id = ?`, p.ID,
			); err != nil {
				return fmt.Errorf("delete overlay for pokemon %q: %w", p.ID, err)
			}
		}
	}
	if err := deleteOverlayNotIn(tx, "pokemon", pokemonIDs); err != nil {
		return fmt.Errorf("delete orphan pokemon overlays: %w", err)
	}
	for _, p := range pokemon {
		if p.Overlay != nil {
			if err := saveOverlay(tx, p.Overlay, "pokemon", p.ID); err != nil {
				return fmt.Errorf("save overlay for pokemon %q: %w", p.ID, err)
			}
		}
	}
	return nil
}

// saveDetectorConfigs upserts or deletes detector_configs rows for each pokemon.
func saveDetectorConfigs(tx *sql.Tx, pokemon []state.Pokemon, pokemonIDs []string) error {
	if err := deleteNotIn(tx, "detector_configs", "pokemon_id", pokemonIDs); err != nil {
		return fmt.Errorf("delete orphan detector_configs: %w", err)
	}
	stmt, err := prepareDetectorConfigStmt(tx)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()

	for _, p := range pokemon {
		if err := upsertSingleDetectorConfig(tx, stmt, p); err != nil {
			return err
		}
	}
	return nil
}

// prepareDetectorConfigStmt creates the prepared statement for upserting
// detector_configs rows.
func prepareDetectorConfigStmt(tx *sql.Tx) (*sql.Stmt, error) {
	stmt, err := tx.Prepare(`
		INSERT INTO detector_configs (pokemon_id, enabled, source_type,
			region_x, region_y, region_w, region_h, window_title,
			change_threshold, adaptive_cooldown, adaptive_cooldown_min)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(pokemon_id) DO UPDATE SET
			enabled               = excluded.enabled,
			source_type           = excluded.source_type,
			region_x              = excluded.region_x,
			region_y              = excluded.region_y,
			region_w              = excluded.region_w,
			region_h              = excluded.region_h,
			window_title          = excluded.window_title,
			change_threshold      = excluded.change_threshold,
			adaptive_cooldown     = excluded.adaptive_cooldown,
			adaptive_cooldown_min = excluded.adaptive_cooldown_min`)
	if err != nil {
		return nil, fmt.Errorf("prepare detector_configs upsert: %w", err)
	}
	return stmt, nil
}

// upsertSingleDetectorConfig handles one Pokémon's detector config: delete
// if nil, upsert otherwise.
func upsertSingleDetectorConfig(tx *sql.Tx, stmt *sql.Stmt, p state.Pokemon) error {
	if p.DetectorConfig == nil {
		if _, err := tx.Exec(`DELETE FROM detector_configs WHERE pokemon_id = ?`, p.ID); err != nil {
			return fmt.Errorf("delete detector_config for %q: %w", p.ID, err)
		}
		return nil
	}
	cfg := p.DetectorConfig
	if _, err := stmt.Exec(
		p.ID, boolToInt(cfg.Enabled), cfg.SourceType,
		cfg.Region.X, cfg.Region.Y, cfg.Region.W, cfg.Region.H,
		cfg.WindowTitle, cfg.ChangeThreshold,
		boolToInt(cfg.AdaptiveCooldown), cfg.AdaptiveCooldownMin,
	); err != nil {
		return fmt.Errorf("upsert detector_config for %q: %w", p.ID, err)
	}
	return nil
}

// saveSessions replaces all session rows.
func saveSessions(tx *sql.Tx, sessions []state.Session) error {
	if _, err := tx.Exec(`DELETE FROM sessions`); err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	stmt, err := tx.Prepare(`
		INSERT INTO sessions (id, pokemon_id, started_at, ended_at, encounters)
		VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare sessions: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for _, s := range sessions {
		if _, err := stmt.Exec(
			s.ID, s.PokemonID,
			s.StartedAt.UTC().Format(time.RFC3339),
			nullTimeStr(s.EndedAt),
			s.Encounters,
		); err != nil {
			return fmt.Errorf("insert session %q: %w", s.ID, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

// deleteNotIn removes rows from table where column is not in the given values.
// If values is empty, all rows are deleted.
func deleteNotIn(tx *sql.Tx, table, column string, values []string) error {
	if len(values) == 0 {
		_, err := tx.Exec(fmt.Sprintf("DELETE FROM %s", table))
		return err
	}
	placeholders, args := buildPlaceholders(values)
	query := fmt.Sprintf("DELETE FROM %s WHERE %s NOT IN (%s)", table, column, placeholders)
	_, err := tx.Exec(query, args...)
	return err
}

// deleteOverlayNotIn removes overlay_settings rows of the given owner_type
// whose owner_id is not in the allowed set.
func deleteOverlayNotIn(tx *sql.Tx, ownerType string, allowedIDs []string) error {
	if len(allowedIDs) == 0 {
		_, err := tx.Exec(`DELETE FROM overlay_settings WHERE owner_type = ?`, ownerType)
		return err
	}
	placeholders, idArgs := buildPlaceholders(allowedIDs)
	args := make([]any, 0, 1+len(idArgs))
	args = append(args, ownerType)
	args = append(args, idArgs...)
	query := fmt.Sprintf(
		"DELETE FROM overlay_settings WHERE owner_type = ? AND owner_id NOT IN (%s)",
		placeholders,
	)
	_, err := tx.Exec(query, args...)
	return err
}

// buildPlaceholders constructs a comma-separated "?, ?, ?" placeholder string
// and a corresponding []any argument slice from string values.
func buildPlaceholders(values []string) (string, []any) {
	var b strings.Builder
	args := make([]any, len(values))
	for i, v := range values {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteByte('?')
		args[i] = v
	}
	return b.String(), args
}
