// hotkey_targets.go serves the resolved binding list and the two routes that
// pin a key to one hunt or one group. They live next to the global hotkey
// handlers because a combo has to be checked against every other combo in use,
// and that check needs the whole picture in one place.

package settings

import (
	"net/http"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/hotkeys"
	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

// errHotkeyTaken is the message returned when a combo is already bound.
const errHotkeyTaken = "hotkey already in use"

// hotkeyConflictResponse names the binding that already holds the requested
// combo, so the caller can point at it instead of showing a bare rejection.
type hotkeyConflictResponse struct {
	Error string             `json:"error"`
	Owner *state.HotkeyOwner `json:"owner,omitempty"`
}

// handleHotkeyBindings returns every binding that should currently be live.
// The macOS relay reads it to register one global shortcut per binding.
// GET /api/hotkeys/bindings
//
// @Summary      List the live hotkey bindings
// @Description  Returns the global bindings plus the key of every running hunt and every group
// @Tags         hotkeys
// @Produce      json
// @Success      200 {array} state.HotkeyBinding
// @Router       /hotkeys/bindings [get]
func (h *handler) handleHotkeyBindings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, h.deps.StateManager().HotkeyBindings())
}

// handleSetPokemonHotkey binds a key combo to one action on one hunt.
// PUT /api/hotkeys/pokemon/{id}/{action}
//
// @Summary      Set one of a hunt's own hotkeys
// @Description  Binds a combo that applies to this hunt whatever the active target is; an empty key clears it
// @Tags         hotkeys
// @Accept       json
// @Produce      json
// @Param        id path string true "Pokemon ID"
// @Param        action path string true "increment, decrement or reset"
// @Param        body body updateHotkeyRequest true "Key combo"
// @Success      200 {object} statusResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      409 {object} hotkeyConflictResponse
// @Router       /hotkeys/pokemon/{id}/{action} [put]
func (h *handler) handleSetPokemonHotkey(w http.ResponseWriter, r *http.Request, path string) {
	h.setEntryHotkey(w, r, "pokemon", path)
}

// handleSetGroupHotkey binds a key combo to one action on one group.
// PUT /api/hotkeys/group/{id}/{action}
//
// @Summary      Set one of a group's own hotkeys
// @Description  Binds a combo that applies to every member of the group whatever the active target is; an empty key clears it
// @Tags         hotkeys
// @Accept       json
// @Produce      json
// @Param        id path string true "Group ID"
// @Param        action path string true "increment, decrement or reset"
// @Param        body body updateHotkeyRequest true "Key combo"
// @Success      200 {object} statusResponse
// @Failure      400 {object} httputil.ErrResp
// @Failure      404 {object} httputil.ErrResp
// @Failure      409 {object} hotkeyConflictResponse
// @Router       /hotkeys/group/{id}/{action} [put]
func (h *handler) handleSetGroupHotkey(w http.ResponseWriter, r *http.Request, path string) {
	h.setEntryHotkey(w, r, "group", path)
}

// splitEntryHotkeyPath cuts "{id}/{action}" apart. The id is a UUID and the
// action is the last segment, so a single split from the right is enough.
func splitEntryHotkeyPath(path string) (id, action string, ok bool) {
	cut := strings.LastIndex(path, "/")
	if cut <= 0 || cut == len(path)-1 {
		return "", "", false
	}
	return path[:cut], path[cut+1:], true
}

// setEntryHotkey validates the combo and stores it on the action of the entry
// the path names. Both routes share it; only the setter at the end differs.
func (h *handler) setEntryHotkey(w http.ResponseWriter, r *http.Request, kind, path string) {
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	id, action, ok := splitEntryHotkeyPath(path)
	if !ok {
		httputil.WriteError(w, http.StatusBadRequest, "expected an entry id and an action")
		return
	}
	var body updateHotkeyRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !h.acceptHotkeyCombo(w, body.Key, state.HotkeyTarget{Kind: kind, ID: id, Action: action}) {
		return
	}
	sm := h.deps.StateManager()
	stored := false
	if kind == "pokemon" {
		stored = sm.SetPokemonHotkey(id, action, body.Key)
	} else {
		stored = sm.SetGroupHotkey(id, action, body.Key)
	}
	if !stored {
		httputil.WriteError(w, http.StatusNotFound, "entry or action not found")
		return
	}
	sm.ScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, statusResponse{Status: "ok"})
}

// acceptHotkeyCombo reports whether the combo may be stored, answering the
// request itself when it may not. An empty combo always passes: it clears the
// binding. The conflict check is a hard gate rather than the hint the settings
// page used to show on its own, because on Windows a combo registered twice
// fails for whichever binding comes second, and nothing surfaces that failure.
func (h *handler) acceptHotkeyCombo(w http.ResponseWriter, combo string, except state.HotkeyTarget) bool {
	if combo == "" {
		return true
	}
	if _, err := hotkeys.ValidateKeyCombo(combo); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return false
	}
	if owner := h.deps.StateManager().HotkeyConflict(combo, except); owner != nil {
		httputil.WriteJSON(w, http.StatusConflict, hotkeyConflictResponse{Error: errHotkeyTaken, Owner: owner})
		return false
	}
	return true
}

// hotkeyActionName translates the action name the HTTP layer uses into the one
// the binding list carries. Only "next_pokemon" differs, but the conflict check
// compares action names, so the two vocabularies have to meet somewhere.
func hotkeyActionName(httpAction string) string {
	if httpAction == "next_pokemon" {
		return "next"
	}
	return httpAction
}
