// Package state defines all application data types and the in-memory state
// manager. Hunt type presets live here and drive detector defaults and odds display.
package state

// HuntTypePreset holds metadata and detector defaults for one shiny hunting method.
type HuntTypePreset struct {
	// Key is the canonical identifier stored in Pokemon.HuntType.
	Key string
	// NameDE is the German display name.
	NameDE string
	// NameEN is the English display name.
	NameEN string
	// OddsNumer and OddsDenom express the base shiny probability as a fraction.
	OddsNumer int
	OddsDenom int
	// DefaultCooldownSec is the recommended minimum seconds between counted encounters.
	DefaultCooldownSec int
	// DefaultConsecutiveHits is the recommended number of matching frames before counting.
	DefaultConsecutiveHits int
	// TemplateTip is an English hint shown to the user when capturing a template.
	TemplateTip string
}

// HuntTypePresets is the ordered list of all supported shiny hunting methods.
// The slice order determines how they appear in the UI.
var HuntTypePresets = []HuntTypePreset{
	{
		Key:                    "encounter",
		NameDE:                 "Zufallsbegegnung",
		NameEN:                 "Wild Encounter",
		OddsNumer:              1,
		OddsDenom:              4096,
		DefaultCooldownSec:     8,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the first frame of the battle intro screen when the wild Pokémon appears.",
	},
	{
		Key:                    "soft_reset",
		NameDE:                 "Soft Reset",
		NameEN:                 "Soft Reset",
		OddsNumer:              1,
		OddsDenom:              4096,
		DefaultCooldownSec:     25,
		DefaultConsecutiveHits: 3,
		TemplateTip:            "Capture the frame where the static Pokémon appears after the game finishes loading.",
	},
	{
		Key:                    "masuda",
		NameDE:                 "Masuda-Methode",
		NameEN:                 "Masuda Method",
		OddsNumer:              1,
		OddsDenom:              683,
		DefaultCooldownSec:     15,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the egg-hatch sparkle frame or the moment the Pokémon sprite appears.",
	},
	{
		Key:                    "fossil",
		NameDE:                 "Fossil-Revival",
		NameEN:                 "Fossil Revival",
		OddsNumer:              1,
		OddsDenom:              4096,
		DefaultCooldownSec:     20,
		DefaultConsecutiveHits: 3,
		TemplateTip:            "Capture the revival cutscene frame or the lab NPC dialogue where the Pokémon is handed over.",
	},
	{
		Key:                    "gift",
		NameDE:                 "Geschenk / Mystery Gift",
		NameEN:                 "Gift / Mystery Gift",
		OddsNumer:              1,
		OddsDenom:              4096,
		DefaultCooldownSec:     20,
		DefaultConsecutiveHits: 3,
		TemplateTip:            "Capture the first frame of the gift-receive animation.",
	},
	{
		Key:                    "radar",
		NameDE:                 "Pokéradar",
		NameEN:                 "Poké Radar",
		OddsNumer:              1,
		OddsDenom:              200,
		DefaultCooldownSec:     5,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the battle intro screen. Each chain encounter counts separately.",
	},
	{
		Key:                    "horde",
		NameDE:                 "Horden-Begegnung",
		NameEN:                 "Horde Encounter",
		OddsNumer:              5,
		OddsDenom:              4096,
		DefaultCooldownSec:     8,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the horde battle first frame showing all five Pokémon sprites.",
	},
	{
		Key:                    "sos",
		NameDE:                 "Notruf-Kette",
		NameEN:                 "SOS Chaining",
		OddsNumer:              1,
		OddsDenom:              683,
		DefaultCooldownSec:     6,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the frame when the new ally Pokémon appears on the field.",
	},
	{
		Key:                    "outbreak",
		NameDE:                 "Massenausbruch",
		NameEN:                 "Mass Outbreak",
		OddsNumer:              1,
		OddsDenom:              4096,
		DefaultCooldownSec:     8,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the Pokémon encounter screen during the outbreak.",
	},
	{
		Key:                    "sandwich",
		NameDE:                 "Sandwich-Methode",
		NameEN:                 "Sandwich Method",
		OddsNumer:              1,
		OddsDenom:              683,
		DefaultCooldownSec:     8,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the encounter screen that appears during the sandwich shiny boost effect.",
	},
	{
		Key:                    "dynamax_adventure",
		NameDE:                 "Dynamax-Abenteuer",
		NameEN:                 "Dynamax Adventure",
		OddsNumer:              1,
		OddsDenom:              100,
		DefaultCooldownSec:     30,
		DefaultConsecutiveHits: 3,
		TemplateTip:            "Capture the result screen at the end of the Dynamax Adventure showing the caught Pokémon.",
	},
	{
		Key:                    "max_raid",
		NameDE:                 "Dyna-Raid",
		NameEN:                 "Max Raid Battle",
		OddsNumer:              1,
		OddsDenom:              4096,
		DefaultCooldownSec:     30,
		DefaultConsecutiveHits: 3,
		TemplateTip:            "Capture the raid result screen when the Pokémon is caught.",
	},
	{
		Key:                    "chain_fishing",
		NameDE:                 "Ketten-Angeln",
		NameEN:                 "Chain Fishing",
		OddsNumer:              1,
		OddsDenom:              100,
		DefaultCooldownSec:     6,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the battle intro screen when a hooked Pokémon appears.",
	},
	{
		Key:                    "friend_safari",
		NameDE:                 "Freundes-Safari",
		NameEN:                 "Friend Safari",
		OddsNumer:              1,
		OddsDenom:              819,
		DefaultCooldownSec:     8,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the battle intro screen in the Friend Safari.",
	},
	{
		Key:                    "dexnav",
		NameDE:                 "DexNav",
		NameEN:                 "DexNav",
		OddsNumer:              1,
		OddsDenom:              512,
		DefaultCooldownSec:     8,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the DexNav encounter battle intro screen.",
	},
	{
		Key:                    "ultra_wormhole",
		NameDE:                 "Ultrapforte",
		NameEN:                 "Ultra Wormhole",
		OddsNumer:              1,
		OddsDenom:              3,
		DefaultCooldownSec:     15,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the encounter screen after entering an Ultra Wormhole.",
	},
	{
		Key:                    "catch_combo",
		NameDE:                 "Fangkombo",
		NameEN:                 "Catch Combo",
		OddsNumer:              1,
		OddsDenom:              273,
		DefaultCooldownSec:     5,
		DefaultConsecutiveHits: 2,
		TemplateTip:            "Capture the overworld screen showing spawning Pokémon during an active catch combo.",
	},
	{
		Key:                    "tera_raid",
		NameDE:                 "Tera-Raid",
		NameEN:                 "Tera Raid Battle",
		OddsNumer:              1,
		OddsDenom:              4096,
		DefaultCooldownSec:     30,
		DefaultConsecutiveHits: 3,
		TemplateTip:            "Capture the raid result screen when the Tera Raid Pokémon is caught.",
	},
}

// HuntTypePresetsByKey is a lookup map from hunt type key to its preset.
// Populated at package init time from HuntTypePresets.
var HuntTypePresetsByKey = func() map[string]HuntTypePreset {
	m := make(map[string]HuntTypePreset, len(HuntTypePresets))
	for _, p := range HuntTypePresets {
		m[p.Key] = p
	}
	return m
}()
