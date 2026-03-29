// Package permissions provides HTTP handlers for querying and requesting
// macOS privacy permissions (Accessibility, Screen Recording).
package permissions

import (
	"net/http"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/permissions"
)

// Deps declares the capabilities the permissions handlers need. Currently
// no external dependencies are required — the permissions package is
// self-contained — but the interface is kept for consistency with other
// handler packages.
type Deps any

// requestBody is the JSON body for POST /api/permissions/request.
type requestBody struct {
	Permission string `json:"permission"`
}

// handler groups the permissions HTTP handlers together.
type handler struct{}

// RegisterRoutes attaches the permissions endpoints to mux.
func RegisterRoutes(mux *http.ServeMux, _ Deps) {
	h := &handler{}
	mux.HandleFunc("/api/permissions", h.handleGetPermissions)
	mux.HandleFunc("/api/permissions/request", h.handleRequestPermission)
}

// handleGetPermissions returns the current macOS permission status.
//
// GET /api/permissions
//
// @Summary      Get permission status
// @Description  Returns the current Accessibility and Screen Recording permission state
// @Tags         permissions
// @Produce      json
// @Success      200 {object} permissions.Status
// @Router       /permissions [get]
func (h *handler) handleGetPermissions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, permissions.GetStatus())
}

// handleRequestPermission triggers the macOS permission request flow for the
// specified permission type.
//
// POST /api/permissions/request
//
// @Summary      Request permission
// @Description  Opens the system dialog or settings pane for the specified permission
// @Tags         permissions
// @Accept       json
// @Produce      json
// @Param        body body requestBody true "Permission to request"
// @Success      200 {object} map[string]string
// @Failure      400 {object} httputil.ErrResp
// @Failure      500 {object} httputil.ErrResp
// @Router       /permissions/request [post]
func (h *handler) handleRequestPermission(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body requestBody
	if err := httputil.ReadJSON(r, &body); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "invalid request body"})
		return
	}

	var err error
	switch body.Permission {
	case "accessibility":
		err = permissions.RequestAccessibility()
	case "screen_recording":
		err = permissions.RequestScreenRecording()
	default:
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrResp{Error: "unknown permission: " + body.Permission})
		return
	}

	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
