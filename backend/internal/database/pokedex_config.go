package database

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrDefaultPokedex reports an attempt to delete the built-in default Pokédex,
// which every hunt falls back to and therefore has to exist.
var ErrDefaultPokedex = errors.New("default pokedex cannot be deleted")

// ErrPokedexScopeConflict reports a scope change that would push a species out
// of a Pokédex that still has that species assigned.
var ErrPokedexScopeConflict = errors.New("pokedex scope would exclude assigned pokemon")

// ErrPokedexHasAssignments reports an attempt to delete a Pokédex that still
// has hunts assigned to it.
var ErrPokedexHasAssignments = errors.New("pokedex still has assigned pokemon")

// UserPokedexRow is the stored form of a user-defined Pokédex. The list-valued
// fields stay JSON-encoded here because they are opaque to SQL and are only
// ever read and written as a whole.
type UserPokedexRow struct {
	ID, Name, GenerationsJSON, TargetGamesJSON, CatchGamesJSON string
	FormCategoriesJSON, IncludeSpeciesJSON, ExcludeSpeciesJSON string
	ShowForms                                                  bool
	// LivingDex restricts an evolved catch to the stage it currently is,
	// instead of unlocking every species it passed through.
	LivingDex bool
	// NameLanguage overrides the language Pokémon names are displayed in for
	// this Pokédex. An empty string means "no override": follow whatever
	// language the UI itself is set to.
	NameLanguage string
}

// ListUserPokedexes returns every user-defined Pokédex in creation order.
func (d *DB) ListUserPokedexes() ([]UserPokedexRow, error) {
	out := []UserPokedexRow{}
	err := eachRow(d.db, `SELECT id,name,show_forms,living_dex,name_language,generations_json,target_games_json,catch_games_json,
		form_categories_json,include_species_json,exclude_species_json FROM user_pokedexes ORDER BY created_at,id`, nil, func(rows *sql.Rows) error {
		var row UserPokedexRow
		var show, living int
		if err := rows.Scan(&row.ID, &row.Name, &show, &living, &row.NameLanguage, &row.GenerationsJSON, &row.TargetGamesJSON, &row.CatchGamesJSON,
			&row.FormCategoriesJSON, &row.IncludeSpeciesJSON, &row.ExcludeSpeciesJSON); err != nil {
			return err
		}
		row.ShowForms = show != 0
		row.LivingDex = living != 0
		out = append(out, row)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SaveUserPokedex inserts or updates a Pokédex. It rejects a scope that would
// exclude a species already assigned to it.
func (d *DB) SaveUserPokedex(row UserPokedexRow) error {
	if err := d.validatePokedexAssignments(row); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.db.Exec(`INSERT INTO user_pokedexes
		(id,name,show_forms,living_dex,name_language,generations_json,target_games_json,catch_games_json,form_categories_json,include_species_json,exclude_species_json,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,show_forms=excluded.show_forms,
		living_dex=excluded.living_dex,name_language=excluded.name_language,
		generations_json=excluded.generations_json,target_games_json=excluded.target_games_json,catch_games_json=excluded.catch_games_json,
		form_categories_json=excluded.form_categories_json,include_species_json=excluded.include_species_json,
		exclude_species_json=excluded.exclude_species_json,updated_at=excluded.updated_at`, row.ID, row.Name, boolToInt(row.ShowForms), boolToInt(row.LivingDex), row.NameLanguage,
		row.GenerationsJSON, row.TargetGamesJSON, row.CatchGamesJSON, row.FormCategoriesJSON, row.IncludeSpeciesJSON, row.ExcludeSpeciesJSON, now, now)
	return err
}

func (d *DB) validatePokedexAssignments(config UserPokedexRow) error {
	var generations, includes, excludes []int
	var targetGames, catchGames []string
	_ = json.Unmarshal([]byte(config.GenerationsJSON), &generations)
	_ = json.Unmarshal([]byte(config.TargetGamesJSON), &targetGames)
	_ = json.Unmarshal([]byte(config.CatchGamesJSON), &catchGames)
	_ = json.Unmarshal([]byte(config.IncludeSpeciesJSON), &includes)
	_ = json.Unmarshal([]byte(config.ExcludeSpeciesJSON), &excludes)
	return eachRow(d.db, `SELECT p.id,p.game,COALESCE(ps.id,base.id,0),COALESCE(ps.games_json,base.games_json,'[]')
		FROM pokedex_pokemon pp JOIN pokemon p ON p.id=pp.pokemon_id
		LEFT JOIN pokedex_species ps ON ps.canonical=p.canonical_name
		LEFT JOIN pokedex_forms pf ON pf.canonical=p.canonical_name
		LEFT JOIN pokedex_species base ON base.id=pf.species_id WHERE pp.pokedex_id=?`, []any{config.ID}, func(rows *sql.Rows) error {
		var pokemonID, game, gamesJSON string
		var speciesID int
		if err := rows.Scan(&pokemonID, &game, &speciesID, &gamesJSON); err != nil {
			return err
		}
		var games []string
		_ = json.Unmarshal([]byte(gamesJSON), &games)
		if !pokedexScopeAllows(speciesID, game, generations, targetGames, catchGames, includes, excludes, games) {
			return fmt.Errorf("%w: %s", ErrPokedexScopeConflict, pokemonID)
		}
		return nil
	})
}

func pokedexScopeAllows(id int, game string, generations []int, targetGames, catchGames []string, includes, excludes []int, speciesGames []string) bool {
	if containsInt(excludes, id) || len(catchGames) > 0 && !containsString(catchGames, game) {
		return false
	}
	if !containsInt(includes, id) && (len(generations) > 0 || len(targetGames) > 0) {
		generation := speciesGeneration(id)
		if !containsInt(generations, generation) && !intersects(targetGames, speciesGames) {
			return false
		}
	}
	return true
}

func containsInt(values []int, value int) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func containsString(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func intersects(a, b []string) bool {
	for _, v := range a {
		if containsString(b, v) {
			return true
		}
	}
	return false
}
func speciesGeneration(id int) int {
	limits := []int{151, 251, 386, 493, 649, 721, 809, 905}
	for i, limit := range limits {
		if id <= limit {
			return i + 1
		}
	}
	return 9
}

// DeleteUserPokedex removes a Pokédex. The default Pokédex and any Pokédex
// that still has assignments are refused.
func (d *DB) DeleteUserPokedex(id string) error {
	if id == "default" {
		return ErrDefaultPokedex
	}
	var assignments int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM pokedex_pokemon WHERE pokedex_id=?`, id).Scan(&assignments); err != nil {
		return err
	}
	if assignments > 0 {
		return ErrPokedexHasAssignments
	}
	res, err := d.db.Exec(`DELETE FROM user_pokedexes WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return err
}
