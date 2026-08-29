// sprite.go provides HTTP handlers for user-uploaded local Pokemon sprite
// images. Images are stored as BLOBs in the database (see SpriteStore) and
// served back over HTTP, mirroring the detector template image flow.
package pokemon

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	// Image format decoders registered for image.DecodeConfig sniffing.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/imageupload"
	"github.com/zsleyer/encounty/backend/internal/state"

	_ "golang.org/x/image/webp"
)

// spriteResponse carries the cache-busting sprite URL returned after upload.
type spriteResponse struct {
	SpriteURL string `json:"sprite_url"`
}

// handleSprite serves a stored sprite (GET), stores an uploaded one (POST), or
// removes a stored one (DELETE).
// GET    /api/pokemon/{id}/sprite
// POST   /api/pokemon/{id}/sprite
// DELETE /api/pokemon/{id}/sprite
//
// @Summary      Get, upload, or delete a Pokemon's local sprite image
// @Tags         pokemon
// @Param        id path string true "Pokemon ID"
// @Success      200 {file} binary
// @Success      200 {object} spriteResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      413 {object} httputil.ErrResp
// @Router       /pokemon/{id}/sprite [get]
// @Router       /pokemon/{id}/sprite [post]
// @Router       /pokemon/{id}/sprite [delete]
func (h *handler) handleSprite(w http.ResponseWriter, r *http.Request, id string) {
	switch r.Method {
	case http.MethodGet:
		h.handleSpriteGet(w, id)
	case http.MethodPost:
		h.handleSpriteUpload(w, r, id)
	case http.MethodDelete:
		h.handleSpriteDelete(w, id)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleSpriteGet writes the stored sprite bytes with their stored mime type.
// GIF is served as image/gif so animated sprites keep animating.
func (h *handler) handleSpriteGet(w http.ResponseWriter, id string) {
	db := h.deps.PokemonDB()
	if db == nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: "no sprite available"})
		return
	}
	data, mime, err := db.LoadSprite(id)
	if err != nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: "no sprite available"})
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

// handleSpriteUpload reads the raw request body (capped at imageupload.MaxBytes),
// validates that it decodes as a supported image, stores it as a BLOB, and
// updates the Pokemon's sprite_url to a cache-busting endpoint URL.
func (h *handler) handleSpriteUpload(w http.ResponseWriter, r *http.Request, id string) {
	db := h.deps.PokemonDB()
	if db == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: "no database configured"})
		return
	}

	// Verify the Pokemon exists before touching the body so an unknown id never
	// writes a sprite for a non-existent owner.
	if !pokemonExists(h.deps.StateGetState(), id) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	data, mime, err := readSpriteBody(w, r)
	if err != nil {
		writeSpriteError(w, err)
		return
	}

	if err := db.SaveSprite(id, data, mime); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	// Cache-bust with the upload time so clients reload the new image.
	spriteURL := fmt.Sprintf("%s%s/sprite?v=%d", pokemonAPIPrefix, id, time.Now().Unix())
	h.deps.StateUpdatePokemon(id, state.Pokemon{SpriteURL: spriteURL})
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, spriteResponse{SpriteURL: spriteURL})
}

// handleSpriteDelete removes the stored sprite BLOB and resets the Pokemon's
// sprite_url to empty. Consumers already fall back to a default sprite icon
// when sprite_url is empty, so no placeholder URL needs to be written.
func (h *handler) handleSpriteDelete(w http.ResponseWriter, id string) {
	db := h.deps.PokemonDB()
	if db == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: "no database configured"})
		return
	}

	if !pokemonExists(h.deps.StateGetState(), id) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errPokemonNotFound})
		return
	}

	if err := db.DeleteSprite(id); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}

	h.deps.StateClearPokemonSprite(id)
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()

	httputil.WriteJSON(w, http.StatusOK, spriteResponse{SpriteURL: ""})
}

// spriteError pairs an HTTP status with a message for upload validation failures.
type spriteError struct {
	status int
	msg    string
}

// Error implements the error interface.
func (e *spriteError) Error() string { return e.msg }

// writeSpriteError writes a spriteError as a JSON error response, defaulting to
// 400 for any non-spriteError value.
func writeSpriteError(w http.ResponseWriter, err error) {
	if se, ok := err.(*spriteError); ok {
		httputil.WriteJSON(w, se.status, httputil.ErrResp{Error: se.msg})
		return
	}
	httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
}

// readSpriteBody reads the request body under the shared size cap and puts it
// through the same validation an overlay background gets: pixel ceiling from
// the header, the same format allowlist, and a downscale above 4K. It returns
// the bytes to store and their mime type, or a spriteError carrying the proper
// HTTP status.
func readSpriteBody(w http.ResponseWriter, r *http.Request) ([]byte, string, error) {
	r.Body = http.MaxBytesReader(w, r.Body, imageupload.MaxBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		// MaxBytesReader surfaces oversized bodies as a *http.MaxBytesError.
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return nil, "", &spriteError{status: http.StatusRequestEntityTooLarge, msg: "sprite exceeds the 30 MB limit"}
		}
		return nil, "", &spriteError{status: http.StatusBadRequest, msg: "failed to read request body"}
	}

	processed, err := imageupload.Process(data)
	if err != nil {
		return nil, "", &spriteError{status: http.StatusBadRequest, msg: err.Error()}
	}
	return processed.Data, processed.Mime, nil
}

// pokemonExists reports whether a Pokemon with the given id is present in st.
func pokemonExists(st state.AppState, id string) bool {
	for i := range st.Pokemon {
		if st.Pokemon[i].ID == id {
			return true
		}
	}
	return false
}
