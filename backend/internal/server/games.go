// games.go delegates game catalogue loading to the gamesync package.
package server

import "github.com/zsleyer/encounty/backend/internal/gamesync"

// gamesDB is set by the server at startup to enable DB-backed game storage.
var gamesDB gamesync.GamesStore

// loadGames delegates to the gamesync package.
func loadGames() []gamesync.GameEntry {
	return gamesync.LoadGames(gamesDB)
}
