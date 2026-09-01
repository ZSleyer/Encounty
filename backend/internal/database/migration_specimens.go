// migration_specimens.go carries migration 55, which rewrites the manually
// recorded Pokédex specimens as ordinary hunt entries. It lives apart from the
// migration registry because it is a data rewrite with a dozen helpers of its
// own, none of which any other migration uses.

package database

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// ---------------------------------------------------------------------------
// Migration 55: manual Pokédex specimens become ordinary hunt entries
// ---------------------------------------------------------------------------

// specimenRow is one pokedex_specimens row joined with the Pokédex name tables,
// carrying everything migrateSpecimensToPokemon needs to write the matching
// pokemon row without going back to the database per field.
type specimenRow struct {
	id                 int64
	pokedexID          string
	speciesID          int
	formCanonical      string
	gender             string
	game               string
	completedAt        string
	huntType           string
	encounters         int
	timerAccumulatedMs int64
	phaseOf            int64
	phaseNumber        int
	metaJSON           string
	createdAt          string
	// speciesCanonical is invalid when no pokedex_species row matches, which
	// is the normal state of a database whose Pokédex sync never ran.
	speciesCanonical sql.NullString
	speciesName      string
	formName         string
	formLabel        string
}

// migrateSpecimensToPokemon rewrites every manually recorded Pokédex specimen
// as a completed hunt in the pokemon table, which is the only catch model the
// application still knows about.
//
// The work is a Go loop rather than a single INSERT ... SELECT because SQLite
// cannot mint the uuid a pokemon row needs as its primary key, and because the
// phase links have to be remapped through those freshly minted ids.
//
// pokedex_specimens is read but never touched: it stays behind as the safety
// net for this release, and the count of already migrated rows makes a rerun
// (a restored backup, a repeated upgrade) a no-op instead of a duplicate.
func migrateSpecimensToPokemon(tx *sql.Tx) error {
	var migrated int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pokemon WHERE entry_source='manual'`).Scan(&migrated); err != nil {
		return fmt.Errorf("count migrated specimens: %w", err)
	}
	if migrated > 0 {
		return nil
	}

	ids, err := mintSpecimenIDs(tx)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}

	language, err := specimenLanguage(tx)
	if err != nil {
		return err
	}
	rows, err := readSpecimens(tx, language)
	if err != nil {
		return err
	}
	var sortOrder int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM pokemon`).Scan(&sortOrder); err != nil {
		return fmt.Errorf("read highest pokemon sort order: %w", err)
	}

	for i, row := range rows {
		if err := insertSpecimenAsPokemon(tx, row, ids, language, sortOrder+i); err != nil {
			return err
		}
	}
	return nil
}

// mintSpecimenIDs assigns one uuid to every specimen id, in id order. The whole
// map is built before the first insert so a phase can point at a parent that
// has not been written yet.
func mintSpecimenIDs(tx *sql.Tx) (map[int64]string, error) {
	rows, err := tx.Query(`SELECT id FROM pokedex_specimens ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list specimen ids: %w", err)
	}

	ids := map[int64]string{}
	err = scanRows(rows, func(rows *sql.Rows) error {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan specimen id: %w", err)
		}
		ids[id] = uuid.NewString()
		return nil
	})
	return ids, err
}

// specimenLanguage returns the language the migrated names are resolved in: the
// user's primary display language, or English when none is configured. The
// empty case has to be caught here because '$.' is not a valid JSON path and
// would fail the whole migration.
func specimenLanguage(tx *sql.Tx) (string, error) {
	var language string
	err := tx.QueryRow(`SELECT language FROM settings_languages ORDER BY sort_order, id LIMIT 1`).Scan(&language)
	if errors.Is(err, sql.ErrNoRows) || language == "" {
		return "en", nil
	}
	if err != nil {
		return "", fmt.Errorf("read primary language: %w", err)
	}
	return language, nil
}

// readSpecimens loads every specimen together with its localized species and
// form names. The joins are outer joins on purpose: a specimen whose species is
// unknown must still be migrated, and dropping it would destroy user data.
func readSpecimens(tx *sql.Tx, language string) ([]specimenRow, error) {
	rows, err := tx.Query(`SELECT s.id, s.pokedex_id, s.species_id, s.form_canonical, s.gender, s.game,
			s.completed_at, s.hunt_type, s.encounters, s.timer_accumulated_ms,
			s.phase_of, s.phase_number, s.meta_json, s.created_at,
			sp.canonical,
			COALESCE(json_extract(sp.names_json, '$.' || ?), json_extract(sp.names_json, '$.en'), ''),
			COALESCE(json_extract(f.names_json, '$.' || ?), json_extract(f.names_json, '$.en'), ''),
			COALESCE(json_extract(f.form_names_json, '$.' || ?), json_extract(f.form_names_json, '$.en'), '')
		FROM pokedex_specimens s
		LEFT JOIN pokedex_species sp ON sp.id = s.species_id
		LEFT JOIN pokedex_forms f ON f.canonical = s.form_canonical AND s.form_canonical <> ''
		ORDER BY s.id`, language, language, language)
	if err != nil {
		return nil, fmt.Errorf("read specimens: %w", err)
	}

	var result []specimenRow
	err = scanRows(rows, func(rows *sql.Rows) error {
		var r specimenRow
		if err := rows.Scan(&r.id, &r.pokedexID, &r.speciesID, &r.formCanonical, &r.gender, &r.game,
			&r.completedAt, &r.huntType, &r.encounters, &r.timerAccumulatedMs,
			&r.phaseOf, &r.phaseNumber, &r.metaJSON, &r.createdAt,
			&r.speciesCanonical, &r.speciesName, &r.formName, &r.formLabel); err != nil {
			return fmt.Errorf("scan specimen: %w", err)
		}
		result = append(result, r)
		return nil
	})
	return result, err
}

// insertSpecimenAsPokemon writes one specimen as a completed, inactive hunt and
// links it into the Pokédex it was recorded in.
func insertSpecimenAsPokemon(tx *sql.Tx, row specimenRow, ids map[int64]string, language string, sortOrder int) error {
	canonicalName, name, baseName, formName := specimenNames(row)
	completedAt := specimenCompletedAt(row)
	createdAt := completedAt
	if t, err := time.Parse(time.RFC3339, row.createdAt); err == nil {
		createdAt = t
	}
	nickname, shinyVariant, catchMeta := splitSpecimenMeta(row.metaJSON)

	if _, err := tx.Exec(`INSERT INTO pokemon
		(id, name, base_name, form_name, nickname, title, canonical_name, gender, sprite_url, sprite_type,
		 sprite_style, encounters, step, is_active, created_at, language, game,
		 completed_at, overlay_mode, hunt_type, shiny_charm, shiny_variant, entry_source, timer_started_at,
		 timer_accumulated_ms, hunt_mode, group_id, phase_of, phase_number, sort_order, catch_meta, failed)
		VALUES (?, ?, ?, ?, ?, '', ?, ?, '', 'shiny',
		        '', ?, 0, 0, ?, ?, ?,
		        ?, 'default', ?, 0, ?, 'manual', NULL,
		        ?, 'both', '', ?, ?, ?, ?, 0)`,
		ids[row.id], name, baseName, formName, nickname, canonicalName, row.gender,
		row.encounters, createdAt.Format(time.RFC3339), language, row.game,
		completedAt.Format(time.RFC3339), row.huntType, shinyVariant,
		row.timerAccumulatedMs, specimenPhaseParent(row.phaseOf, ids), row.phaseNumber, sortOrder, catchMeta,
	); err != nil {
		return fmt.Errorf("insert specimen %d as pokemon: %w", row.id, err)
	}
	return linkSpecimenPokedex(tx, row.pokedexID, ids[row.id])
}

// specimenNames derives the four name columns of a pokemon row from a specimen.
// A species that resolves to nothing keeps a "#<species id>" placeholder rather
// than being dropped, because an unsynced Pokédex must not cost the user their
// recorded catches.
func specimenNames(row specimenRow) (canonicalName, name, baseName, formName string) {
	if !row.speciesCanonical.Valid {
		return row.formCanonical, fmt.Sprintf("#%d", row.speciesID), "", ""
	}
	speciesName := row.speciesName
	if speciesName == "" {
		speciesName = row.speciesCanonical.String
	}
	if row.formCanonical == "" {
		return row.speciesCanonical.String, speciesName, speciesName, ""
	}
	formName = row.formName
	if formName == "" {
		formName = row.formCanonical
	}
	return row.formCanonical, formName, speciesName, row.formLabel
}

// specimenCompletedAt turns the date-only completion a specimen carries into a
// timestamp at local midnight. A missing or unreadable date falls back to the
// specimen's creation time and finally to now: a pokemon row without a
// completion is a running hunt, which a recorded catch must never become.
func specimenCompletedAt(row specimenRow) time.Time {
	if t, err := time.ParseInLocation("2006-01-02", row.completedAt, time.Local); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, row.createdAt); err == nil {
		return t
	}
	return time.Now()
}

// splitSpecimenMeta lifts the nickname and the shiny variant out of a specimen's
// metadata blob into their own pokemon columns and returns the remaining
// metadata for catch_meta. The remainder is re-encoded through the same
// state.CatchMeta shape the state loader reads, so a migrated row survives the
// next full save unchanged; a blob holding nothing else becomes "" (no
// metadata), never "{}".
func splitSpecimenMeta(raw string) (nickname, shinyVariant, catchMeta string) {
	var meta state.CatchMeta
	if json.Unmarshal([]byte(raw), &meta) != nil {
		return "", "", ""
	}
	nickname = meta.Nickname
	if meta.ShinyVariant == "star" || meta.ShinyVariant == "square" {
		shinyVariant = meta.ShinyVariant
	}
	meta.Nickname = ""
	meta.ShinyVariant = ""
	if meta.IsEmpty() {
		return nickname, shinyVariant, ""
	}
	if meta.Ribbons == nil {
		meta.Ribbons = []string{}
	}
	encoded, err := json.Marshal(&meta)
	if err != nil {
		return nickname, shinyVariant, ""
	}
	return nickname, shinyVariant, string(encoded)
}

// specimenPhaseParent maps a specimen's phase link onto the minted pokemon ids.
// A link to a specimen that no longer exists keeps pointing at nothing, which is
// exactly the orphaned phase a deleted hunt leaves behind.
func specimenPhaseParent(phaseOf int64, ids map[int64]string) string {
	if phaseOf == 0 {
		return ""
	}
	if id, ok := ids[phaseOf]; ok {
		return id
	}
	return uuid.NewString()
}

// linkSpecimenPokedex records the migrated hunt as a member of the Pokédex the
// specimen belonged to. pokedex_pokemon carries a foreign key on user_pokedexes,
// so a Pokédex that was deleted in the meantime falls back to the default one,
// and a database without even that keeps the hunt without a membership.
func linkSpecimenPokedex(tx *sql.Tx, pokedexID, pokemonID string) error {
	target, ok, err := existingPokedexID(tx, pokedexID)
	if err != nil || !ok {
		return err
	}
	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO pokedex_pokemon (pokedex_id, pokemon_id) VALUES (?, ?)`, target, pokemonID,
	); err != nil {
		return fmt.Errorf("link pokemon %q into pokedex %q: %w", pokemonID, target, err)
	}
	return nil
}

// existingPokedexID resolves the Pokédex a migrated hunt can be attached to,
// preferring the recorded one and falling back to 'default'.
func existingPokedexID(tx *sql.Tx, pokedexID string) (string, bool, error) {
	for _, candidate := range []string{pokedexID, "default"} {
		if candidate == "" {
			continue
		}
		var found string
		err := tx.QueryRow(`SELECT id FROM user_pokedexes WHERE id = ?`, candidate).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return "", false, fmt.Errorf("look up pokedex %q: %w", candidate, err)
		}
		return found, true, nil
	}
	return "", false, nil
}
