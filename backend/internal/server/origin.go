// origin.go defines which browser origins may talk to the loopback API.
//
// Binding to 127.0.0.1 keeps the API off the network, but it does not keep it
// away from the browser: any page the user visits can send a cross-site request
// to http://127.0.0.1:8192. CORS only governs whether the attacker may *read*
// the response, so a body-less POST such as /api/hotkeys/trigger/increment
// takes effect regardless. Checking Origin on state-changing requests closes
// that hole, because browsers set the header on cross-site requests and scripts
// cannot forge it.
package server

import (
	"net/http"
	"net/url"
	"strconv"
)

// devServerPort is the Vite dev server port, allowed as an origin only when the
// backend runs with -dev.
const devServerPort = "5173"

// electronAppOrigin is the origin of the packaged Electron renderer, which
// loads the frontend from the custom encounty:// scheme.
const electronAppOrigin = "encounty://app"

// originPolicy reports which Origin header values belong to this instance.
type originPolicy struct {
	port    int
	devMode bool
}

// allows reports whether origin may issue requests to this server. An empty
// origin is accepted: non-browser clients (Electron's main process, curl, the
// overlay's native integrations) do not send the header, and browsers always
// do on cross-site requests.
func (p originPolicy) allows(origin string) bool {
	if origin == "" || origin == electronAppOrigin {
		return true
	}

	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" {
		return false
	}

	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
	default:
		return false
	}

	// Port-exact, so another local tool on a different port is not implicitly
	// trusted just for running on loopback.
	port := u.Port()
	return port == strconv.Itoa(p.port) || (p.devMode && port == devServerPort)
}

// allowsRequest reports whether r's Origin header is acceptable.
func (p originPolicy) allowsRequest(r *http.Request) bool {
	return p.allows(r.Header.Get("Origin"))
}

// isStateChanging reports whether method can modify server state and therefore
// needs the origin check. Safe methods are left alone so that overlays, sprites
// and other sub-resources keep loading; without a CORS header a foreign page
// still cannot read their responses.
func isStateChanging(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}
