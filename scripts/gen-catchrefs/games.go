// games.go maps every game key from backend/internal/gamesync/fallback_games.json
// to the PKHeX location group that covers it.
package main

// gameToGroup maps a hunt's game key to a PKHeX location group. All 54 keys
// of fallback_games.json must be present, the generator has no way to invent
// one at runtime. An empty value means the game has no PKHeX location table
// and the runtime returns an empty list.
//
// Several games appear under two keys (an abbreviated one and a spelled out
// one) because the game list grew over time, both have to be mapped.
var gameToGroup = map[string]string{
	// Gen 1: Red, Blue and Yellow store no met location, PKHeX has no gen1
	// location directory at all.
	"pokemon-red":    "",
	"pokemon-blue":   "",
	"pokemon-yellow": "",

	// Gen 2: Gold, Silver and Crystal share the gsc table.
	"pokemon-gold":    "gsc",
	"pokemon-silver":  "gsc",
	"pokemon-crystal": "gsc",

	// Gen 3 handhelds: Ruby, Sapphire, Emerald, FireRed and LeafGreen share
	// the rsefrlg table.
	"pokemon-ruby":      "rsefrlg",
	"pokemon-sapphire":  "rsefrlg",
	"pokemon-emerald":   "rsefrlg",
	"pokemon-firered":   "rsefrlg",
	"pokemon-leafgreen": "rsefrlg",

	// Gen 3 GameCube spin-offs: Colosseum and XD share the cxd table.
	"pokemon-colosseum": "cxd",
	"pokemon-xd":        "cxd",

	// Gen 4: Diamond, Pearl, Platinum, HeartGold and SoulSilver share the
	// hgss table, PKHeX keeps no separate dppt file.
	"pokemon-diamond":    "hgss",
	"pokemon-pearl":      "hgss",
	"pokemon-platinum":   "hgss",
	"pokemon-heartgold":  "hgss",
	"pokemon-soulsilver": "hgss",

	// Gen 5: Black, White and their sequels share the bw2 table.
	"pokemon-black":   "bw2",
	"pokemon-white":   "bw2",
	"pokemon-black-2": "bw2",
	"pokemon-black2":  "bw2",
	"pokemon-white-2": "bw2",
	"pokemon-white2":  "bw2",

	// Gen 6: X, Y and both ORAS titles share the xy table.
	"pokemon-x":              "xy",
	"pokemon-y":              "xy",
	"pokemon-omega-ruby":     "xy",
	"pokemon-alpha-sapphire": "xy",
	"pokemon-oras-omega":     "xy",
	"pokemon-oras-alpha":     "xy",

	// Gen 7 handhelds: Sun, Moon and both Ultra titles share the sm table.
	"pokemon-sun":        "sm",
	"pokemon-moon":       "sm",
	"pokemon-ultra-sun":  "sm",
	"pokemon-ultra-moon": "sm",
	"pokemon-ultrasun":   "sm",
	"pokemon-ultramoon":  "sm",

	// Gen 7 Switch: both Let's Go titles share the gg table.
	"pokemon-lets-go-pikachu": "gg",
	"pokemon-lets-go-eevee":   "gg",
	"pokemon-letsgopikachu":   "gg",
	"pokemon-letsgoeevee":     "gg",

	// Gen 8: Sword and Shield.
	"pokemon-sword":  "swsh",
	"pokemon-shield": "swsh",

	// Gen 8: Legends Arceus.
	"pokemon-legends":        "la",
	"pokemon-legends-arceus": "la",

	// Gen 8: Brilliant Diamond and Shining Pearl.
	"pokemon-bd":                "bdsp",
	"pokemon-sp":                "bdsp",
	"pokemon-brilliant-diamond": "bdsp",
	"pokemon-shining-pearl":     "bdsp",

	// Gen 9: Scarlet and Violet.
	"pokemon-scarlet": "sv",
	"pokemon-violet":  "sv",

	// Gen 9: Legends Z-A and its Mega Dimension expansion share the za table.
	"pokemon-legends-za":     "za",
	"pokemon-mega-dimension": "za",

	// Gen 10: announced but unreleased, PKHeX has no location table yet.
	"pokemon-waves": "",
	"pokemon-winds": "",
}
