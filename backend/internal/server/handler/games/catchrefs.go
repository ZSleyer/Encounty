// catchrefs.go serves the embedded reference lists a hunter picks from when
// recording a catch. The data ships with the binary and needs no dependencies.
package games

import (
	"net/http"

	"github.com/zsleyer/encounty/backend/internal/catchrefs"
	"github.com/zsleyer/encounty/backend/internal/httputil"
)

// catchRefsCacheControl keeps these lists out of the renderer's cache. They are
// read from memory over the loopback interface, so caching them saves nothing
// measurable, while a cached copy survives the app update that replaces the
// data and cannot be evicted by the user: that shipped once as
// "max-age=86400, immutable" and left the previous release's ball names on
// screen for a day.
const catchRefsCacheControl = "no-store"

// locationsResponse pairs the PKHeX location group covering a game with its
// met locations. The group name is returned so the caller can tell "unknown
// game" (empty group) from "game without a location table".
type locationsResponse struct {
	Group     string               `json:"group"`
	Locations []catchrefs.Location `json:"locations"`
}

// handleGetCatchRefs returns the natures, balls, abilities, ribbons and marks
// a catch can be annotated with. GET /api/catch-refs
//
// @Summary      Get the catch reference lists
// @Description  Returns natures, balls, abilities, ribbons and marks
// @Tags         catchrefs
// @Produce      json
// @Success      200 {object} catchrefs.Refs
// @Router       /catch-refs [get]
func (h *handler) handleGetCatchRefs(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", catchRefsCacheControl)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(catchrefs.RefsJSON())
}

// handleGetCatchRefLocations returns the met locations of the game named by
// the "game" query parameter. An unknown or missing game yields an empty list
// rather than an error, because the location field accepts free text anyway.
// GET /api/catch-refs/locations?game=<key>
//
// @Summary      Get the met locations of a game
// @Tags         catchrefs
// @Produce      json
// @Param        game query string false "Game key from /api/games"
// @Success      200 {object} locationsResponse
// @Router       /catch-refs/locations [get]
func (h *handler) handleGetCatchRefLocations(w http.ResponseWriter, r *http.Request) {
	group, locs := catchrefs.LocationsFor(r.URL.Query().Get("game"))
	w.Header().Set("Cache-Control", catchRefsCacheControl)
	httputil.WriteJSON(w, http.StatusOK, locationsResponse{Group: group, Locations: locs})
}
