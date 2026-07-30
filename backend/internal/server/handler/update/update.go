// Package update provides the HTTP handler for the update check endpoint.
package update

import (
	"log/slog"
	"net/http"
	"os"
	"runtime"

	"github.com/zsleyer/encounty/backend/internal/httputil"
	"github.com/zsleyer/encounty/backend/internal/updater"
)

// Deps declares the capabilities the update handler needs.
type Deps interface {
	// Version returns the current binary version string.
	Version() string
}

type handler struct {
	deps Deps
}

// selfUpdateHandled reports whether the Electron shell applies updates on its
// own, which makes a GitHub check pointless. That is the case for the plain
// Linux AppImage, where electron-updater rewrites the file in place. Installs
// that cannot do so (distribution packages) set ENCOUNTY_SELF_UPDATE=0, and
// there the frontend needs the real answer so it can point at the package
// manager instead.
func selfUpdateHandled() bool {
	return os.Getenv("ENCOUNTY_ELECTRON") == "1" &&
		runtime.GOOS == "linux" &&
		os.Getenv("ENCOUNTY_SELF_UPDATE") != "0"
}

// RegisterRoutes attaches the update check endpoint to mux.
func RegisterRoutes(mux *http.ServeMux, d Deps) {
	h := &handler{deps: d}
	mux.HandleFunc("GET /api/update/check", h.handleUpdateCheck)
}

// handleUpdateCheck queries the GitHub Releases API for the latest release
// and returns an UpdateInfo payload indicating whether an update is available.
// In dev mode (version == "dev") it always returns available=false.
//
// @Summary      Check for available updates
// @Tags         system
// @Produce      json
// @Success      200 {object} updater.UpdateInfo
// @Failure      500 {object} httputil.ErrResp
// @Router       /update/check [get]
func (h *handler) handleUpdateCheck(w http.ResponseWriter, _ *http.Request) {
	version := h.deps.Version()
	if version == "dev" {
		httputil.WriteJSON(w, http.StatusOK, updater.UpdateInfo{
			Available:      false,
			CurrentVersion: version,
		})
		return
	}
	if selfUpdateHandled() {
		httputil.WriteJSON(w, http.StatusOK, updater.UpdateInfo{
			Available:      false,
			CurrentVersion: version,
		})
		return
	}
	info, err := updater.CheckForUpdate(version)
	if err != nil {
		slog.Error("Update check error", "error", err)
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrResp{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, info)
}
