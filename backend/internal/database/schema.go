// schema.go defines the normalized database schema (v2) for Encounty.
// All application state is stored in properly typed columns instead of
// a single JSON blob. Existing encounter_events and timer_sessions tables
// are preserved unchanged.
package database

// schemaV2 contains the DDL statements for the normalized schema.
// They are idempotent (CREATE TABLE IF NOT EXISTS) so they can be run
// on every startup without harm. Foreign keys use ON DELETE CASCADE.
var schemaV2 = []string{
	// ── App config (singleton) ───────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS app_config (
		id               INTEGER PRIMARY KEY CHECK (id = 1),
		active_id        TEXT    NOT NULL DEFAULT '',
		license_accepted INTEGER NOT NULL DEFAULT 0,
		data_path        TEXT    NOT NULL DEFAULT '',
		updated_at       TEXT    NOT NULL DEFAULT ''
	)`,

	// ── Hotkeys (singleton) ──────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS hotkeys (
		id           INTEGER PRIMARY KEY CHECK (id = 1),
		increment    TEXT NOT NULL DEFAULT '',
		decrement    TEXT NOT NULL DEFAULT '',
		reset        TEXT NOT NULL DEFAULT '',
		next_pokemon TEXT NOT NULL DEFAULT ''
	)`,

	// ── Settings (singleton) ─────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS settings (
		id                      INTEGER PRIMARY KEY CHECK (id = 1),
		output_enabled          INTEGER NOT NULL DEFAULT 0,
		output_dir              TEXT    NOT NULL DEFAULT '',
		auto_save               INTEGER NOT NULL DEFAULT 1,
		crisp_sprites           INTEGER NOT NULL DEFAULT 1,
		ui_animations           INTEGER NOT NULL DEFAULT 1,
		config_path             TEXT    NOT NULL DEFAULT '',
		tutorial_overlay_editor INTEGER NOT NULL DEFAULT 0,
		tutorial_auto_detection INTEGER NOT NULL DEFAULT 0
	)`,

	// ── Settings languages (1:N) ─────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS settings_languages (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		language   TEXT    NOT NULL,
		sort_order INTEGER NOT NULL DEFAULT 0
	)`,

	// ── Pokemon ──────────────────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS pokemon (
		id                   TEXT    PRIMARY KEY,
		name                 TEXT    NOT NULL,
		title                TEXT    NOT NULL DEFAULT '',
		canonical_name       TEXT    NOT NULL DEFAULT '',
		sprite_url           TEXT    NOT NULL DEFAULT '',
		sprite_type          TEXT    NOT NULL DEFAULT 'normal',
		sprite_style         TEXT    NOT NULL DEFAULT '',
		encounters           INTEGER NOT NULL DEFAULT 0,
		step                 INTEGER NOT NULL DEFAULT 0,
		is_active            INTEGER NOT NULL DEFAULT 0,
		created_at           TEXT    NOT NULL DEFAULT '',
		language             TEXT    NOT NULL DEFAULT 'en',
		game                 TEXT    NOT NULL DEFAULT '',
		completed_at         TEXT,
		overlay_mode         TEXT    NOT NULL DEFAULT 'default',
		hunt_type            TEXT    NOT NULL DEFAULT '',
		timer_started_at     TEXT,
		timer_accumulated_ms INTEGER NOT NULL DEFAULT 0,
		hunt_mode            TEXT    NOT NULL DEFAULT 'both',
		sort_order           INTEGER NOT NULL DEFAULT 0
	)`,

	// ── Sessions ─────────────────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS sessions (
		id         TEXT    PRIMARY KEY,
		pokemon_id TEXT    NOT NULL,
		started_at TEXT    NOT NULL,
		ended_at   TEXT,
		encounters INTEGER NOT NULL DEFAULT 0
	)`,

	// ── Overlay settings (canvas/background) ─────────────────────────────
	// owner_type: 'global' for the default overlay, 'pokemon' for per-pokemon.
	// owner_id:   'default' for global, or the pokemon UUID.
	`CREATE TABLE IF NOT EXISTS overlay_settings (
		id                         INTEGER PRIMARY KEY AUTOINCREMENT,
		owner_type                 TEXT    NOT NULL,
		owner_id                   TEXT    NOT NULL,
		canvas_width               INTEGER NOT NULL DEFAULT 800,
		canvas_height              INTEGER NOT NULL DEFAULT 200,
		hidden                     INTEGER NOT NULL DEFAULT 0,
		background_color           TEXT    NOT NULL DEFAULT '#000000',
		background_opacity         REAL    NOT NULL DEFAULT 0.6,
		background_animation       TEXT    NOT NULL DEFAULT 'none',
		background_animation_speed REAL    NOT NULL DEFAULT 0,
		background_image           TEXT    NOT NULL DEFAULT '',
		background_image_fit       TEXT    NOT NULL DEFAULT '',
		blur                       INTEGER NOT NULL DEFAULT 8,
		show_border                INTEGER NOT NULL DEFAULT 1,
		border_color               TEXT    NOT NULL DEFAULT '',
		border_width               INTEGER NOT NULL DEFAULT 0,
		border_radius              INTEGER NOT NULL DEFAULT 40,
		UNIQUE(owner_type, owner_id)
	)`,

	// ── Overlay elements (sprite, name, title, counter) ──────────────────
	`CREATE TABLE IF NOT EXISTS overlay_elements (
		id             INTEGER PRIMARY KEY AUTOINCREMENT,
		overlay_id     INTEGER NOT NULL,
		element_type   TEXT    NOT NULL,
		visible        INTEGER NOT NULL DEFAULT 1,
		x              INTEGER NOT NULL DEFAULT 0,
		y              INTEGER NOT NULL DEFAULT 0,
		width          INTEGER NOT NULL DEFAULT 0,
		height         INTEGER NOT NULL DEFAULT 0,
		z_index        INTEGER NOT NULL DEFAULT 0,
		show_glow      INTEGER,
		glow_color     TEXT,
		glow_opacity   REAL,
		glow_blur      INTEGER,
		idle_animation TEXT    NOT NULL DEFAULT 'none',
		trigger_enter     TEXT    NOT NULL DEFAULT 'none',
		trigger_exit      TEXT    NOT NULL DEFAULT '',
		trigger_decrement TEXT    NOT NULL DEFAULT 'none',
		show_label     INTEGER,
		label_text     TEXT,
		UNIQUE(overlay_id, element_type),
		FOREIGN KEY (overlay_id) REFERENCES overlay_settings(id) ON DELETE CASCADE
	)`,

	// ── Text styles ──────────────────────────────────────────────────────
	// style_role: 'main' for the primary style, 'label' for counter label.
	`CREATE TABLE IF NOT EXISTS text_styles (
		id                         INTEGER PRIMARY KEY AUTOINCREMENT,
		element_id                 INTEGER NOT NULL,
		style_role                 TEXT    NOT NULL DEFAULT 'main',
		font_family                TEXT    NOT NULL DEFAULT 'sans',
		font_size                  INTEGER NOT NULL DEFAULT 16,
		font_weight                INTEGER NOT NULL DEFAULT 400,
		text_align                 TEXT    NOT NULL DEFAULT '',
		color_type                 TEXT    NOT NULL DEFAULT 'solid',
		color                      TEXT    NOT NULL DEFAULT '#ffffff',
		gradient_angle             INTEGER NOT NULL DEFAULT 0,
		outline_type               TEXT    NOT NULL DEFAULT 'none',
		outline_width              INTEGER NOT NULL DEFAULT 0,
		outline_color              TEXT    NOT NULL DEFAULT '#000000',
		outline_gradient_angle     INTEGER NOT NULL DEFAULT 0,
		text_shadow                INTEGER NOT NULL DEFAULT 0,
		text_shadow_color          TEXT    NOT NULL DEFAULT '',
		text_shadow_color_type     TEXT    NOT NULL DEFAULT 'solid',
		text_shadow_gradient_angle INTEGER NOT NULL DEFAULT 0,
		text_shadow_blur           INTEGER NOT NULL DEFAULT 0,
		text_shadow_x              INTEGER NOT NULL DEFAULT 0,
		text_shadow_y              INTEGER NOT NULL DEFAULT 0,
		UNIQUE(element_id, style_role),
		FOREIGN KEY (element_id) REFERENCES overlay_elements(id) ON DELETE CASCADE
	)`,

	// ── Gradient stops ───────────────────────────────────────────────────
	// gradient_type: 'color', 'outline', or 'shadow'.
	`CREATE TABLE IF NOT EXISTS gradient_stops (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		text_style_id INTEGER NOT NULL,
		gradient_type TEXT    NOT NULL,
		color         TEXT    NOT NULL,
		position      REAL    NOT NULL,
		sort_order    INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (text_style_id) REFERENCES text_styles(id) ON DELETE CASCADE
	)`,

	// ── Detector configs (1:1 optional per pokemon) ──────────────────────
	`CREATE TABLE IF NOT EXISTS detector_configs (
		pokemon_id          TEXT    PRIMARY KEY,
		enabled             INTEGER NOT NULL DEFAULT 0,
		source_type         TEXT    NOT NULL DEFAULT '',
		region_x            INTEGER NOT NULL DEFAULT 0,
		region_y            INTEGER NOT NULL DEFAULT 0,
		region_w            INTEGER NOT NULL DEFAULT 0,
		region_h            INTEGER NOT NULL DEFAULT 0,
		window_title        TEXT    NOT NULL DEFAULT '',
		precision_val       REAL    NOT NULL DEFAULT 0.85,
		consecutive_hits    INTEGER NOT NULL DEFAULT 1,
		cooldown_sec        INTEGER NOT NULL DEFAULT 8,
		change_threshold    REAL    NOT NULL DEFAULT 0.15,
		poll_interval_ms    INTEGER NOT NULL DEFAULT 50,
		min_poll_ms         INTEGER NOT NULL DEFAULT 30,
		max_poll_ms         INTEGER NOT NULL DEFAULT 500,
		adaptive_cooldown     INTEGER NOT NULL DEFAULT 0,
		adaptive_cooldown_min INTEGER NOT NULL DEFAULT 3,
		FOREIGN KEY (pokemon_id) REFERENCES pokemon(id) ON DELETE CASCADE
	)`,

	// ── Detector templates (image stored as BLOB) ────────────────────────
	`CREATE TABLE IF NOT EXISTS detector_templates (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		pokemon_id TEXT    NOT NULL,
		image_data BLOB   NOT NULL,
		name       TEXT    NOT NULL DEFAULT '',
		sort_order INTEGER NOT NULL DEFAULT 0,
		enabled    INTEGER NOT NULL DEFAULT 1,
		FOREIGN KEY (pokemon_id) REFERENCES detector_configs(pokemon_id) ON DELETE CASCADE
	)`,

	// ── Template matched regions ─────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS template_regions (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		template_id   INTEGER NOT NULL,
		type          TEXT    NOT NULL DEFAULT 'image',
		expected_text TEXT    NOT NULL DEFAULT '',
		rect_x        INTEGER NOT NULL DEFAULT 0,
		rect_y        INTEGER NOT NULL DEFAULT 0,
		rect_w        INTEGER NOT NULL DEFAULT 0,
		rect_h        INTEGER NOT NULL DEFAULT 0,
		sort_order    INTEGER NOT NULL DEFAULT 0,
		is_negative   INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (template_id) REFERENCES detector_templates(id) ON DELETE CASCADE
	)`,

	// ── Detection log (capped per pokemon) ───────────────────────────────
	`CREATE TABLE IF NOT EXISTS detection_log (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		pokemon_id TEXT    NOT NULL,
		at         TEXT    NOT NULL,
		confidence REAL    NOT NULL,
		FOREIGN KEY (pokemon_id) REFERENCES detector_configs(pokemon_id) ON DELETE CASCADE
	)`,

	// ── Game names (normalized from JSON) ────────────────────────────────
	`CREATE TABLE IF NOT EXISTS game_names (
		game_key TEXT NOT NULL,
		language TEXT NOT NULL,
		name     TEXT NOT NULL,
		PRIMARY KEY (game_key, language),
		FOREIGN KEY (game_key) REFERENCES games(key) ON DELETE CASCADE
	)`,

	// ── Pokedex species ─────────────────────────────────────────────────
	`CREATE TABLE IF NOT EXISTS pokedex_species (
		id         INTEGER PRIMARY KEY,
		canonical  TEXT    NOT NULL UNIQUE,
		names_json TEXT    NOT NULL DEFAULT '{}'
	)`,

	// ── Pokedex forms (alternate forms per species) ──────────────────────
	`CREATE TABLE IF NOT EXISTS pokedex_forms (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		species_id INTEGER NOT NULL,
		canonical  TEXT    NOT NULL UNIQUE,
		sprite_id  INTEGER NOT NULL DEFAULT 0,
		names_json TEXT    NOT NULL DEFAULT '{}',
		FOREIGN KEY (species_id) REFERENCES pokedex_species(id) ON DELETE CASCADE
	)`,

	// ── Indexes ──────────────────────────────────────────────────────────
	`CREATE INDEX IF NOT EXISTS idx_overlay_owner ON overlay_settings(owner_type, owner_id)`,
	`CREATE INDEX IF NOT EXISTS idx_elements_overlay ON overlay_elements(overlay_id)`,
	`CREATE INDEX IF NOT EXISTS idx_text_styles_element ON text_styles(element_id)`,
	`CREATE INDEX IF NOT EXISTS idx_gradient_stops_style ON gradient_stops(text_style_id)`,
	`CREATE INDEX IF NOT EXISTS idx_detector_templates_pokemon ON detector_templates(pokemon_id)`,
	`CREATE INDEX IF NOT EXISTS idx_template_regions_tmpl ON template_regions(template_id)`,
	`CREATE INDEX IF NOT EXISTS idx_detection_log_pokemon ON detection_log(pokemon_id)`,
	`CREATE INDEX IF NOT EXISTS idx_game_names_key ON game_names(game_key)`,
	`CREATE INDEX IF NOT EXISTS idx_pokedex_forms_species ON pokedex_forms(species_id)`,
}
