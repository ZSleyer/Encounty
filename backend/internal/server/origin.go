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
	"log/slog"
	"net"
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

	return p.allowsPort(u.Port())
}

// allowsPort reports whether port belongs to this instance. The comparison is
// exact, so another local tool on a different port is not implicitly trusted
// just for running on loopback.
func (p originPolicy) allowsPort(port string) bool {
	return port == strconv.Itoa(p.port) || (p.devMode && port == devServerPort)
}

// allowsHost reports whether host, as sent in the Host header, names this
// server. It closes DNS rebinding, which the Origin check cannot: a page on
// attacker.example whose name resolves to 127.0.0.1 reaches the API as its own
// origin, so no Origin header is sent on GET at all and the response is
// same-origin readable. The Host header still carries the attacker's name.
//
// An empty host is accepted. Only an HTTP/1.0 client leaves it out (Go rejects
// an HTTP/1.1 request without one), and a browser always sends it.
func (p originPolicy) allowsHost(host string) bool {
	if host == "" {
		return true
	}

	name, port, err := net.SplitHostPort(host)
	if err != nil {
		return false
	}
	switch name {
	case "localhost", "127.0.0.1", "::1":
	default:
		return false
	}
	return p.allowsPort(port)
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

// corsMiddleware echoes CORS headers back to the origins this instance belongs
// to. The packaged app is not same-origin with its API: the renderer loads from
// encounty://app and calls http://localhost:8192, so without a matching
// Access-Control-Allow-Origin the browser blocks every response. Echoing the
// request's own origin keeps the allowlist authoritative instead of handing out
// a wildcard.
//
// It also rejects state-changing requests from unknown origins; see origin.go
// for why CORS alone does not cover that case.
func corsMiddleware(next http.Handler, policy originPolicy) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ahead of the origin check and not limited to state-changing methods:
		// a rebound host reaches the API without an Origin header at all, and
		// what it is after is reading GET responses.
		if !policy.allowsHost(r.Host) {
			slog.Warn("Rejected request for a foreign host", "host", r.Host, "path", r.URL.Path)
			http.Error(w, "host not allowed", http.StatusForbidden)
			return
		}
		// Vary regardless of the outcome: the response differs per origin, so a
		// cache must not reuse one origin's answer for another.
		w.Header().Add("Vary", "Origin")
		if origin := r.Header.Get("Origin"); origin != "" && policy.allows(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if isStateChanging(r.Method) && !policy.allowsRequest(r) {
			slog.Warn("Rejected cross-origin request",
				"origin", r.Header.Get("Origin"), "method", r.Method, "path", r.URL.Path)
			http.Error(w, "cross-origin request forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
