// validate.go holds the input validation and normalization rules of the
// Pokemon endpoints. It is free of HTTP and handler state so the same rules can
// be reused by other handler packages that accept catch metadata.

package pokemon

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// Length limits of the free-text catch metadata fields, in runes. Location is
// a sentence, the remaining fields hold a single name or slug.
const (
	catchLocationMaxRunes = 120
	catchFieldMaxRunes    = 60
	catchRibbonsMax       = 64
)

// cleanCatchText trims a free-text catch field and drops the control characters
// a paste can carry in, so a stored note cannot break the overlay renderer.
func cleanCatchText(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s))
}

// ValidateCatchMeta normalizes the catch metadata in place (trimming text,
// stripping control characters, deduplicating ribbons) and rejects values
// outside the ranges the game itself allows. A nil or empty meta is valid: it
// clears the record. Exported so other handler packages that also accept
// catch metadata (e.g. dexoverride) can enforce the same rules.
func ValidateCatchMeta(meta *state.CatchMeta) error {
	if meta == nil {
		return nil
	}
	meta.Nickname = cleanCatchText(meta.Nickname)
	meta.Location = cleanCatchText(meta.Location)
	meta.Nature = cleanCatchText(meta.Nature)
	meta.Ability = cleanCatchText(meta.Ability)
	meta.Ball = cleanCatchText(meta.Ball)
	meta.Mark = cleanCatchText(meta.Mark)

	if utf8.RuneCountInString(meta.Location) > catchLocationMaxRunes {
		return fmt.Errorf("location must be at most %d characters", catchLocationMaxRunes)
	}
	for _, f := range []struct {
		name  string
		value string
	}{
		{"nickname", meta.Nickname}, {"nature", meta.Nature}, {"ability", meta.Ability},
		{"ball", meta.Ball}, {"mark", meta.Mark},
	} {
		if utf8.RuneCountInString(f.value) > catchFieldMaxRunes {
			return fmt.Errorf("%s must be at most %d characters", f.name, catchFieldMaxRunes)
		}
	}

	if meta.Level != nil && (*meta.Level < 1 || *meta.Level > 100) {
		return errors.New("level must be between 1 and 100")
	}
	for _, v := range []struct {
		name string
		v    *int
	}{
		{"hp", meta.HP}, {"atk", meta.Atk}, {"def", meta.Def},
		{"sp_atk", meta.SpAtk}, {"sp_def", meta.SpDef}, {"speed", meta.Speed},
	} {
		if v.v != nil && (*v.v < 0 || *v.v > 31) {
			return fmt.Errorf("%s must be between 0 and 31", v.name)
		}
	}
	if err := ValidateShinyVariant(meta.ShinyVariant); err != nil {
		return err
	}
	if len(meta.Evolutions) > 32 {
		return errors.New("at most 32 evolution steps are allowed")
	}
	for i := range meta.Evolutions {
		step := &meta.Evolutions[i]
		step.CanonicalName = cleanCatchText(step.CanonicalName)
		if step.CanonicalName == "" || utf8.RuneCountInString(step.CanonicalName) > catchFieldMaxRunes {
			return errors.New("evolution canonical_name is required and must be at most 60 characters")
		}
		if err := ValidateGender(step.Gender); err != nil {
			return err
		}
	}

	return ValidateCatchRibbons(meta)
}

// ValidateGender accepts the gender values exposed by the API.
func ValidateGender(gender string) error {
	if gender != "" && gender != "male" && gender != "female" && gender != "genderless" {
		return errors.New("gender must be male, female, genderless, or empty")
	}
	return nil
}

// ValidateShinyVariant accepts the shiny variant values exposed by the API.
// The empty string means the variant was not recorded, which is the only
// possible state outside Sword/Shield.
func ValidateShinyVariant(variant string) error {
	if variant != "" && variant != "star" && variant != "square" {
		return errors.New("shiny_variant must be star, square, or empty")
	}
	return nil
}

// entrySourceManual marks an entry that was typed in after the fact instead of
// being tracked in this app.
const entrySourceManual = "manual"

// ValidateEntrySource accepts the entry source values exposed by the API. The
// empty string means the entry was tracked in this app, which is the source of
// every hunt predating hand-entered catches.
func ValidateEntrySource(source string) error {
	if source != "" && source != entrySourceManual {
		return errors.New("entry_source must be manual or empty")
	}
	return nil
}

// validateNewPokemon rejects a posted entry before anything is stored. It sits
// apart from the handler so the add path keeps a single validation branch.
func validateNewPokemon(p state.Pokemon) error {
	if err := validatePokemonGenders(p); err != nil {
		return err
	}
	if err := ValidateEntrySource(p.EntrySource); err != nil {
		return err
	}
	if err := ValidateShinyVariant(p.ShinyVariant); err != nil {
		return err
	}
	if p.EntrySource == entrySourceManual && p.CompletedAt == nil {
		return errors.New("completed_at is required when entry_source is manual")
	}
	return nil
}

// applyEntryDefaults fills the fields a client is not expected to send. A
// hand-entered catch is history, never a running hunt: it gets no detector
// config (there is nothing left to detect) and none of the live-hunt state,
// while a tracked hunt keeps the default detector config it always had.
func applyEntryDefaults(p *state.Pokemon) {
	if p.EntrySource != entrySourceManual {
		if p.DetectorConfig == nil {
			p.DetectorConfig = state.DefaultDetectorConfig()
		}
		return
	}
	p.DetectorConfig = nil
	p.IsActive = false
	p.TimerStartedAt = nil
	p.Overlay = nil
	p.OverlayMode = "default"
	p.PhaseTargets = []state.PhaseTarget{}
}

func validatePokemonGenders(p state.Pokemon) error {
	if err := ValidateGender(p.Gender); err != nil {
		return err
	}
	for _, target := range p.PhaseTargets {
		if err := ValidateGender(target.Gender); err != nil {
			return err
		}
	}
	return nil
}

// ValidateCatchRibbons cleans and deduplicates the ribbon slugs in place. It
// lives apart from ValidateCatchMeta so neither function grows a second loop
// nesting level. Exported alongside ValidateCatchMeta for the same reason.
func ValidateCatchRibbons(meta *state.CatchMeta) error {
	if len(meta.Ribbons) > catchRibbonsMax {
		return fmt.Errorf("at most %d ribbons are allowed", catchRibbonsMax)
	}
	seen := make(map[string]struct{}, len(meta.Ribbons))
	cleaned := make([]string, 0, len(meta.Ribbons))
	for _, ribbon := range meta.Ribbons {
		ribbon = cleanCatchText(ribbon)
		if ribbon == "" {
			continue
		}
		if utf8.RuneCountInString(ribbon) > catchFieldMaxRunes {
			return fmt.Errorf("a ribbon must be at most %d characters", catchFieldMaxRunes)
		}
		if _, dup := seen[ribbon]; dup {
			continue
		}
		seen[ribbon] = struct{}{}
		cleaned = append(cleaned, ribbon)
	}
	meta.Ribbons = cleaned
	return nil
}
