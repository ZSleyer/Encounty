// state_load_detector.go reads the detector tables (detector_configs,
// detector_templates, template_regions and detection_log) with one query each
// and reassembles the per-Pokémon DetectorConfig from them. It is the load half
// of the detector persistence, split out of state_load.go.

package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// ---------------------------------------------------------------------------
// Detector batching
// ---------------------------------------------------------------------------

// attachDetectors loads detector configs, templates, regions, and detection
// logs with one query per table and attaches the assembled DetectorConfig to
// each Pokémon that has one.
func attachDetectors(db *sql.DB, pokemon []state.Pokemon) error {
	configs, err := loadAllDetectorConfigs(db)
	if err != nil {
		return fmt.Errorf("load detector configs: %w", err)
	}
	if len(configs) == 0 {
		return nil
	}

	regions, err := loadAllTemplateRegions(db)
	if err != nil {
		return fmt.Errorf("load template regions: %w", err)
	}
	templates, err := loadAllDetectorTemplates(db, regions)
	if err != nil {
		return fmt.Errorf("load detector templates: %w", err)
	}
	logs, err := loadAllDetectionLogs(db)
	if err != nil {
		return fmt.Errorf("load detection logs: %w", err)
	}

	for id, cfg := range configs {
		if t, ok := templates[id]; ok {
			cfg.Templates = t
		}
		if l, ok := logs[id]; ok {
			cfg.DetectionLog = l
		}
	}
	for i := range pokemon {
		if cfg, ok := configs[pokemon[i].ID]; ok {
			pokemon[i].DetectorConfig = cfg
		}
	}
	return nil
}

// loadAllDetectorConfigs reads every detector_configs row into a map keyed by
// pokemon_id. Each config starts with non-nil empty Templates and DetectionLog
// slices so JSON serialization never emits null.
func loadAllDetectorConfigs(db *sql.DB) (map[string]*state.DetectorConfig, error) {
	configs := map[string]*state.DetectorConfig{}
	err := eachRow(db, `SELECT pokemon_id, enabled, source_type, region_x, region_y, region_w, region_h,
		window_title, change_threshold, adaptive_cooldown, adaptive_cooldown_min
		FROM detector_configs`, nil, func(rows *sql.Rows) error {
		var pokemonID string
		var dc state.DetectorConfig
		var enabled, adaptiveCooldown int
		if err := rows.Scan(&pokemonID, &enabled, &dc.SourceType, &dc.Region.X, &dc.Region.Y, &dc.Region.W, &dc.Region.H,
			&dc.WindowTitle, &dc.ChangeThreshold, &adaptiveCooldown, &dc.AdaptiveCooldownMin); err != nil {
			return err
		}
		dc.Enabled = enabled != 0
		dc.AdaptiveCooldown = adaptiveCooldown != 0
		dc.Templates = []state.DetectorTemplate{}
		dc.DetectionLog = []state.DetectionLogEntry{}
		cfg := dc
		configs[pokemonID] = &cfg
		return nil
	})
	return configs, err
}

// loadAllDetectorTemplates reads every detector_templates row (without the
// image_data BLOB), groups them by pokemon_id in sort_order, and attaches the
// preloaded regions for each template.
func loadAllDetectorTemplates(db *sql.DB, regions map[int64][]state.MatchedRegion) (map[string][]state.DetectorTemplate, error) {
	templates := map[string][]state.DetectorTemplate{}
	err := eachRow(db, `SELECT pokemon_id, id, name, sort_order, enabled, calibration, precision_val, hysteresis_factor,
		consecutive_hits, cooldown_sec, poll_interval_ms, min_poll_ms, max_poll_ms, hysteresis_mode
		FROM detector_templates ORDER BY pokemon_id, sort_order`, nil, func(rows *sql.Rows) error {
		var pokemonID string
		var t state.DetectorTemplate
		var sortOrder int
		var enabledInt int
		var calibration sql.NullString
		var precision, hysteresis sql.NullFloat64
		var consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs sql.NullInt64
		var hysteresisMode sql.NullString
		if err := rows.Scan(&pokemonID, &t.TemplateDBID, &t.Name, &sortOrder, &enabledInt, &calibration, &precision, &hysteresis,
			&consecutiveHits, &cooldownSec, &pollIntervalMs, &minPollMs, &maxPollMs, &hysteresisMode); err != nil {
			return err
		}
		applyTemplateNullables(&t, enabledInt, calibration, precision, hysteresis,
			consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs, hysteresisMode)
		if r, ok := regions[t.TemplateDBID]; ok {
			t.Regions = r
		} else {
			t.Regions = []state.MatchedRegion{}
		}
		templates[pokemonID] = append(templates[pokemonID], t)
		return nil
	})
	return templates, err
}

// applyTemplateNullables copies the nullable template columns onto t, mirroring
// the pointer semantics used by the frontend detection engine.
func applyTemplateNullables(t *state.DetectorTemplate, enabledInt int, calibration sql.NullString,
	precision, hysteresis sql.NullFloat64,
	consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs sql.NullInt64,
	hysteresisMode sql.NullString) {
	enabled := enabledInt != 0
	t.Enabled = &enabled
	if calibration.Valid && calibration.String != "" {
		t.Calibration = json.RawMessage(calibration.String)
	}
	if precision.Valid {
		t.Precision = &precision.Float64
	}
	if hysteresis.Valid {
		t.HysteresisFactor = &hysteresis.Float64
	}
	if consecutiveHits.Valid {
		v := int(consecutiveHits.Int64)
		t.ConsecutiveHits = &v
	}
	if cooldownSec.Valid {
		v := int(cooldownSec.Int64)
		t.CooldownSec = &v
	}
	if pollIntervalMs.Valid {
		v := int(pollIntervalMs.Int64)
		t.PollIntervalMs = &v
	}
	if minPollMs.Valid {
		v := int(minPollMs.Int64)
		t.MinPollMs = &v
	}
	if maxPollMs.Valid {
		v := int(maxPollMs.Int64)
		t.MaxPollMs = &v
	}
	if hysteresisMode.Valid && hysteresisMode.String != "" {
		t.HysteresisMode = &hysteresisMode.String
	}
}

// loadAllTemplateRegions reads every template_regions row into a map keyed by
// template_id, preserving sort_order within each template.
func loadAllTemplateRegions(db *sql.DB) (map[int64][]state.MatchedRegion, error) {
	regions := map[int64][]state.MatchedRegion{}
	err := eachRow(db, `SELECT template_id, type, expected_text, rect_x, rect_y, rect_w, rect_h, is_negative, category
		FROM template_regions ORDER BY template_id, sort_order`, nil, func(rows *sql.Rows) error {
		var templateID int64
		var r state.MatchedRegion
		var isNeg int
		if err := rows.Scan(&templateID, &r.Type, &r.ExpectedText, &r.Rect.X, &r.Rect.Y, &r.Rect.W, &r.Rect.H, &isNeg, &r.Category); err != nil {
			return err
		}
		regions[templateID] = append(regions[templateID], r)
		return nil
	})
	return regions, err
}

// loadAllDetectionLogs reads every detection_log row and returns the most
// recent 20 entries per pokemon (id DESC), matching the per-Pokémon LIMIT of
// the original per-parent query.
func loadAllDetectionLogs(db *sql.DB) (map[string][]state.DetectionLogEntry, error) {
	logs := map[string][]state.DetectionLogEntry{}
	err := eachRow(db, `SELECT pokemon_id, at, confidence, category FROM detection_log ORDER BY pokemon_id, id DESC`, nil, func(rows *sql.Rows) error {
		var pokemonID string
		var e state.DetectionLogEntry
		var atStr string
		if err := rows.Scan(&pokemonID, &atStr, &e.Confidence, &e.Category); err != nil {
			return err
		}
		if len(logs[pokemonID]) >= 20 {
			return nil
		}
		if t, err := time.Parse(time.RFC3339, atStr); err == nil {
			e.At = t
		}
		logs[pokemonID] = append(logs[pokemonID], e)
		return nil
	})
	return logs, err
}
