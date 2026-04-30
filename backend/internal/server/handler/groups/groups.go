// Package groups provides HTTP handlers for Pokémon organisational groups.
// Groups are purely cosmetic metadata — they arrange Pokémon into Sidebar
// sections and expose bulk hunt start/stop endpoints but do not alter the
// single-active-Pokémon semantics of the encounter counter.
package groups

import (
	"net/http"
	"strings"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/state"
)

const (
	groupsPrefix       = "/api/groups"
	groupsPrefixSlash  = "/api/groups/"
	errGroupNotFound   = "group not found"
	suffixStartHunt    = "/start-hunt"
	suffixStopHunt     = "/stop-hunt"
	reasonAlreadyRun   = "already_running"
	reasonNotRunning   = "not_running"
	reasonNotFound     = "pokemon_not_found"
	wsHuntStartEvent   = "hunt_start_requested"
	wsHuntStopEvent    = "hunt_stop_requested"
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

// huntMemberResult reports what happened for one Pokémon inside a bulk
// start-hunt / stop-hunt call.
type huntMemberResult struct {
	ID      string `json:"id"`
	Started bool   `json:"started,omitempty"`
	Stopped bool   `json:"stopped,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// huntBulkResponse is the body returned by /api/groups/{id}/start-hunt and
// /api/groups/{id}/stop-hunt.
type huntBulkResponse struct {
	Members []huntMemberResult `json:"members"`
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

// dispatchGroupAction routes /api/groups/{id}/... requests to the correct
// handler based on URL suffix and HTTP method.
func (h *handler) dispatchGroupAction(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case strings.HasSuffix(path, suffixStartHunt):
		if r.Method == http.MethodPost {
			h.handleStartHunt(w, r, httputil.IDFromPath(path, groupsPrefixSlash, suffixStartHunt))
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case strings.HasSuffix(path, suffixStopHunt):
		if r.Method == http.MethodPost {
			h.handleStopHunt(w, r, httputil.IDFromPath(path, groupsPrefixSlash, suffixStopHunt))
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	default:
		id := httputil.IDFromPath(path, groupsPrefixSlash, "")
		switch r.Method {
		case http.MethodPut:
			h.handleUpdate(w, r, id)
		case http.MethodDelete:
			h.handleDelete(w, r, id)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
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
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
		return
	}
	g, err := h.deps.StateCreateGroup(body.Name, body.Color)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
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
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "group id required"})
		return
	}
	var body updateGroupRequest
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: err.Error()})
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
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: err.Error()})
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
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "group id required"})
		return
	}
	if !h.deps.StateDeleteGroup(id) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errGroupNotFound})
		return
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	w.WriteHeader(http.StatusNoContent)
}

// handleStartHunt toggles the timer to running for every group member whose
// timer is not already running. For each started member a hunt_start_requested
// event is broadcast so the frontend can kick off its detection loop.
// POST /api/groups/{id}/start-hunt
func (h *handler) handleStartHunt(w http.ResponseWriter, _ *http.Request, groupID string) {
	if !h.groupExists(groupID) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errGroupNotFound})
		return
	}
	members := h.membersOfGroup(groupID)
	results := make([]huntMemberResult, 0, len(members))
	for _, p := range members {
		results = append(results, h.startOneMember(p))
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, huntBulkResponse{Members: results})
}

// handleStopHunt toggles the timer to stopped for every group member whose
// timer is currently running. A hunt_stop_requested event is broadcast per
// stopped member.
// POST /api/groups/{id}/stop-hunt
func (h *handler) handleStopHunt(w http.ResponseWriter, _ *http.Request, groupID string) {
	if !h.groupExists(groupID) {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrResp{Error: errGroupNotFound})
		return
	}
	members := h.membersOfGroup(groupID)
	results := make([]huntMemberResult, 0, len(members))
	for _, p := range members {
		results = append(results, h.stopOneMember(p))
	}
	h.deps.StateScheduleSave()
	h.deps.BroadcastState()
	httputil.WriteJSON(w, http.StatusOK, huntBulkResponse{Members: results})
}

// --- Helpers -----------------------------------------------------------------

// groupExists reports whether a group with the given id currently exists.
func (h *handler) groupExists(id string) bool {
	for _, g := range h.deps.StateListGroups() {
		if g.ID == id {
			return true
		}
	}
	return false
}

// membersOfGroup returns all Pokémon whose GroupID matches groupID, based on
// a single consistent state snapshot.
func (h *handler) membersOfGroup(groupID string) []state.Pokemon {
	st := h.deps.StateGetState()
	out := make([]state.Pokemon, 0, len(st.Pokemon))
	for _, p := range st.Pokemon {
		if p.GroupID == groupID {
			out = append(out, p)
		}
	}
	return out
}

// startOneMember starts p's hunt. If the timer is not yet running it is
// toggled on and a hunt_start_requested event broadcast. If the timer is
// already running, the event is broadcast anyway so the frontend can
// (re)start the detection loop for members whose hunt was previously
// started manually without a detector attached.
func (h *handler) startOneMember(p state.Pokemon) huntMemberResult {
	if p.TimerStartedAt != nil {
		h.deps.Broadcast(wsHuntStartEvent, map[string]any{
			"pokemon_id": p.ID,
			"hunt_mode":  p.HuntMode,
		})
		return huntMemberResult{ID: p.ID, Started: false, Reason: reasonAlreadyRun}
	}
	running, huntMode, ok := h.deps.StateToggleHunt(p.ID)
	if !ok {
		return huntMemberResult{ID: p.ID, Started: false, Reason: reasonNotFound}
	}
	if !running {
		// ToggleHunt flipped the opposite direction, which should be
		// impossible after the TimerStartedAt nil check above. Report
		// defensively instead of silently discarding the signal.
		return huntMemberResult{ID: p.ID, Started: false, Reason: reasonAlreadyRun}
	}
	h.deps.Broadcast(wsHuntStartEvent, map[string]any{
		"pokemon_id": p.ID,
		"hunt_mode":  huntMode,
	})
	return huntMemberResult{ID: p.ID, Started: true}
}

// stopOneMember stops p's hunt. The stop event is always broadcast so the
// frontend can tear down a detection loop whose timer was already stopped
// (e.g. started manually without a timer). The backend timer is only
// toggled when it is currently running.
func (h *handler) stopOneMember(p state.Pokemon) huntMemberResult {
	if p.TimerStartedAt == nil {
		h.deps.Broadcast(wsHuntStopEvent, map[string]any{
			"pokemon_id": p.ID,
		})
		return huntMemberResult{ID: p.ID, Stopped: false, Reason: reasonNotRunning}
	}
	running, _, ok := h.deps.StateToggleHunt(p.ID)
	if !ok {
		return huntMemberResult{ID: p.ID, Stopped: false, Reason: reasonNotFound}
	}
	if running {
		// Unexpected: toggled but still running. Surface the anomaly.
		return huntMemberResult{ID: p.ID, Stopped: false, Reason: reasonNotRunning}
	}
	h.deps.Broadcast(wsHuntStopEvent, map[string]any{
		"pokemon_id": p.ID,
	})
	return huntMemberResult{ID: p.ID, Stopped: true}
}
