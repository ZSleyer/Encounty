// Package groups provides HTTP handlers for Pokémon organisational groups.
// Groups are purely cosmetic metadata — they arrange Pokémon into Sidebar
// sections and expose bulk hunt start/stop endpoints but do not alter the
// single-active-Pokémon semantics of the encounter counter.
package groups

import (
	"net/http"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	groupsPrefix      = "/api/groups"
	groupsPrefixSlash = "/api/groups/"
	errGroupNotFound  = "group not found"
	reasonAlreadyRun  = "already_running"
	reasonNotRunning  = "not_running"
	reasonNotFound    = "pokemon_not_found"
	wsHuntStartEvent  = "hunt_start_requested"
	wsHuntStopEvent   = "hunt_stop_requested"
)

// --- DTO types ---------------------------------------------------------------

// createGroupRequest is the body for POST /api/groups.
type createGroupRequest struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
}

// updateGroupRequest is the body for PUT /api/groups/{id}. All fields are
// optional; omitted fields leave the existing value untouched.
type updateGroupRequest struct {
	Name      *string `json:"name,omitempty"`
	Color     *string `json:"color,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
	Collapsed *bool   `json:"collapsed,omitempty"`
}

// listGroupsResponse wraps the group list for GET /api/groups so clients can
// distinguish a missing field from an empty list in the JSON output.
type listGroupsResponse struct {
	Groups []state.Group `json:"groups"`
}

// --- Deps interface ----------------------------------------------------------

// Deps declares the capabilities the groups handlers need from the application
// layer, keeping the package decoupled from the concrete Server type.
type Deps interface {
	// Group and tag state mutations.
	StateListGroups() []state.Group
	StateCreateGroup(name, color string) (state.Group, error)
	StateUpdateGroup(id string, patch state.GroupPatch) (state.Group, error)
	StateDeleteGroup(id string) bool
	StateGetState() state.AppState

	// StateToggleHunt flips the timer for a Pokémon and reports the
	// post-toggle running flag plus the Pokémon's hunt_mode for broadcast.
	StateToggleHunt(id string) (running bool, huntMode string, ok bool)

	// Infrastructure.
	StateScheduleSave()
	// Broadcast sends a typed message to all connected WebSocket clients.
	Broadcast(msgType string, payload any)
	BroadcastState()
}

// --- Handler -----------------------------------------------------------------

// handler groups the HTTP handlers for the /api/groups family together with
// their dependencies.
type handler struct {
	deps Deps
}

// RegisterRoutes wires the /api/groups and /api/groups/{id}* routes onto mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}

	mux.HandleFunc(groupsPrefix, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.handleList(w, r)
		case http.MethodPost:
			h.handleCreate(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc(groupsPrefixSlash, func(w http.ResponseWriter, r *http.Request) {
		h.dispatchGroupAction(w, r)
	})
}

// dispatchGroupAction routes /api/groups/{id} requests by HTTP method. Any
// trailing path segment stays part of the id and simply fails to match a group,
// which is what a request to one of the removed bulk-hunt routes now does.
func (h *handler) dispatchGroupAction(w http.ResponseWriter, r *http.Request) {
	id := httputil.IDFromPath(r.URL.Path, groupsPrefixSlash, "")
	switch r.Method {
	case http.MethodPut:
		h.handleUpdate(w, r, id)
	case http.MethodDelete:
		h.handleDelete(w, r, id)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// --- Handlers ----------------------------------------------------------------

// handleList returns all groups.
// GET /api/groups
func (h *handler) handleList(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, listGroupsResponse{Groups: h.deps.StateListGroups()})
}

// handleCreate creates a new group.
// POST /api/groups
func (h *handler) handleCreate(w http.ResponseWriter, r *http.Request) {
	var body createGroupRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	g, err := h.deps.StateCreateGroup(body.Name, body.Color)
	if err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusCreated, g)
}

// handleUpdate applies a partial update to one group.
// PUT /api/groups/{id}
func (h *handler) handleUpdate(w http.ResponseWriter, r *http.Request, id string) {
	if id == "" {
		httputil.WriteError(w, http.StatusBadRequest, "group id required")
		return
	}
	var body updateGroupRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	patch := state.GroupPatch{
		Name:      body.Name,
		Color:     body.Color,
		SortOrder: body.SortOrder,
		Collapsed: body.Collapsed,
	}
	g, err := h.deps.StateUpdateGroup(id, patch)
	if err != nil {
		httputil.WriteError(w, http.StatusNotFound, err.Error())
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, g)
}

// handleDelete removes a group and clears GroupID on its former members.
// DELETE /api/groups/{id}
func (h *handler) handleDelete(w http.ResponseWriter, _ *http.Request, id string) {
	if id == "" {
		httputil.WriteError(w, http.StatusBadRequest, "group id required")
		return
	}
	if !h.deps.StateDeleteGroup(id) {
		httputil.WriteError(w, http.StatusNotFound, errGroupNotFound)
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// --- Helpers -----------------------------------------------------------------
