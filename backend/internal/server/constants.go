// constants.go — shared string literals used across server handlers.
package server

const (
	errPokemonNotFound = "pokemon not found"
	dbFilename         = "encounty.db"
	statsPokemonPrefix = "/api/stats/pokemon/"
	contentTypeJSON    = "application/json"
	pokemonAPIPrefix   = "/api/pokemon/"
	templateFileFmt    = "template_%d.png"
)
