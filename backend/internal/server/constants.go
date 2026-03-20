// constants.go — shared string literals used across server handlers.
package server

const (
	errPokemonNotFound = "pokemon not found"
	dbFilename         = "encounty.db"
	pokemonFilename    = "pokemon.json"
	statsPokemonPrefix = "/api/stats/pokemon/"
	langJaHrkt         = "ja-Hrkt"
	contentTypeJSON    = "application/json"
	pokeAPIGraphQL     = "https://beta.pokeapi.co/graphql/v1beta"
	pokemonPrefix      = "Pokémon "
	pokemonAPIPrefix   = "/api/pokemon/"
	templateFileFmt    = "template_%d.png"
)
