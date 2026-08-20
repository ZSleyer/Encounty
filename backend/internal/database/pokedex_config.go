package database

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var ErrDefaultPokedex = errors.New("default pokedex cannot be deleted")
var ErrPokedexScopeConflict = errors.New("pokedex scope would exclude assigned pokemon")
var ErrPokedexHasAssignments = errors.New("pokedex still has assigned pokemon")

type UserPokedexRow struct {
	ID, Name, GenerationsJSON, TargetGamesJSON, CatchGamesJSON string
	FormCategoriesJSON, IncludeSpeciesJSON, ExcludeSpeciesJSON string
	ShowForms                                                  bool
}

func (d *DB) ListUserPokedexes() ([]UserPokedexRow, error) {
	rows, err := d.db.Query(`SELECT id,name,show_forms,generations_json,target_games_json,catch_games_json,
		form_categories_json,include_species_json,exclude_species_json FROM user_pokedexes ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []UserPokedexRow{}
	for rows.Next() {
		var row UserPokedexRow
		var show int
		if err := rows.Scan(&row.ID, &row.Name, &show, &row.GenerationsJSON, &row.TargetGamesJSON, &row.CatchGamesJSON,
			&row.FormCategoriesJSON, &row.IncludeSpeciesJSON, &row.ExcludeSpeciesJSON); err != nil {
			return nil, err
		}
		row.ShowForms = show != 0
		out = append(out, row)
	}
	return out, rows.Err()
}

func (d *DB) SaveUserPokedex(row UserPokedexRow) error {
	if err := d.validatePokedexAssignments(row); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.db.Exec(`INSERT INTO user_pokedexes
		(id,name,show_forms,generations_json,target_games_json,catch_games_json,form_categories_json,include_species_json,exclude_species_json,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,show_forms=excluded.show_forms,
		generations_json=excluded.generations_json,target_games_json=excluded.target_games_json,catch_games_json=excluded.catch_games_json,
		form_categories_json=excluded.form_categories_json,include_species_json=excluded.include_species_json,
		exclude_species_json=excluded.exclude_species_json,updated_at=excluded.updated_at`, row.ID, row.Name, boolToInt(row.ShowForms),
		row.GenerationsJSON, row.TargetGamesJSON, row.CatchGamesJSON, row.FormCategoriesJSON, row.IncludeSpeciesJSON, row.ExcludeSpeciesJSON, now, now)
	return err
}

var regionalForm = regexp.MustCompile(`(?:^|-)(?:alola|galar|hisui|paldea)(?:-|$)`)

func (d *DB) validatePokedexAssignments(config UserPokedexRow) error {
	rows, err := d.db.Query(`SELECT p.id,p.canonical_name,p.game,COALESCE(ps.id,base.id,0),COALESCE(ps.games_json,base.games_json,'[]'),CASE WHEN pf.id IS NULL THEN 0 ELSE 1 END,COALESCE(pf.sprite_id,-1),COALESCE(pf.gender,'')
		FROM pokedex_pokemon pp JOIN pokemon p ON p.id=pp.pokemon_id
		LEFT JOIN pokedex_species ps ON ps.canonical=p.canonical_name
		LEFT JOIN pokedex_forms pf ON pf.canonical=p.canonical_name
		LEFT JOIN pokedex_species base ON base.id=pf.species_id WHERE pp.pokedex_id=?`, config.ID)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	var generations, includes, excludes []int
	var targetGames, catchGames, categories []string
	_ = json.Unmarshal([]byte(config.GenerationsJSON), &generations)
	_ = json.Unmarshal([]byte(config.TargetGamesJSON), &targetGames)
	_ = json.Unmarshal([]byte(config.CatchGamesJSON), &catchGames)
	_ = json.Unmarshal([]byte(config.FormCategoriesJSON), &categories)
	_ = json.Unmarshal([]byte(config.IncludeSpeciesJSON), &includes)
	_ = json.Unmarshal([]byte(config.ExcludeSpeciesJSON), &excludes)
	for rows.Next() {
		var pokemonID, canonical, game, gamesJSON, formGender string
		var speciesID, isForm, spriteID int
		if err := rows.Scan(&pokemonID, &canonical, &game, &speciesID, &gamesJSON, &isForm, &spriteID, &formGender); err != nil {
			return err
		}
		var games []string
		_ = json.Unmarshal([]byte(gamesJSON), &games)
		if !pokedexScopeAllows(speciesID, canonical, game, isForm != 0, spriteID, formGender, config.ShowForms, generations, targetGames, catchGames, categories, includes, excludes, games) {
			return fmt.Errorf("%w: %s", ErrPokedexScopeConflict, pokemonID)
		}
	}
	return rows.Err()
}

func pokedexScopeAllows(id int, canonical, game string, isForm bool, spriteID int, formGender string, showForms bool, generations []int, targetGames, catchGames, categories []string, includes, excludes []int, speciesGames []string) bool {
	if containsInt(excludes, id) || len(catchGames) > 0 && !containsString(catchGames, game) {
		return false
	}
	if !containsInt(includes, id) && (len(generations) > 0 || len(targetGames) > 0) {
		generation := speciesGeneration(id)
		if !containsInt(generations, generation) && !intersects(targetGames, speciesGames) {
			return false
		}
	}
	if isForm {
		return showForms && containsString(categories, formCategoryForScope(canonical, spriteID, formGender))
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
func formCategoryForScope(canonical string, spriteID int, gender string) string {
	if gender != "" {
		return "gender"
	}
	if regionalForm.MatchString(canonical) {
		return "regional"
	}
	if strings.Contains(canonical, "-mega") {
		return "mega"
	}
	if strings.HasSuffix(canonical, "-gmax") {
		return "gigantamax"
	}
	if spriteID == 0 {
		return "cosmetic"
	}
	return "other"
}

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
