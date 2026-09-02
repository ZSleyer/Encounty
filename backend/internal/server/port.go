// Package server provides the HTTP/WebSocket server for the Encounty API.

package server

// DefaultPort is the fixed port the backend listens on.
// 8192 = the classic shiny encounter odds (1/8192) from Gen 2–5.
const DefaultPort = 8192

// tlsPortOffset places the TLS listener directly above the plain HTTP one, so
// the two ports are never configured independently and cannot drift apart.
const tlsPortOffset = 1

// tlsPortFor returns the TLS port belonging to the plain HTTP port.
func tlsPortFor(httpPort int) int {
	return httpPort + tlsPortOffset
}
