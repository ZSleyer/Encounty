// websocket.go implements the WebSocket hub that maintains active client
// connections and routes messages between the server and all browser tabs.
// On every state mutation the hub broadcasts a "state_update" message so
// all connected clients stay in sync without polling.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// upgrader promotes HTTP connections to WebSocket. CheckOrigin always returns
// true because the app is a single-user localhost server — no CSRF risk.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WSMessage is the envelope used for all WebSocket messages in both
// directions. Type selects the action; Payload carries JSON-encoded data.
type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// Hub tracks all active WebSocket connections. A read/write mutex guards the
// clients map so Broadcast can safely iterate while ServeWS may concurrently
// add or remove connections.
type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]bool
}

// NewHub creates an empty Hub ready to accept connections.
func NewHub() *Hub {
	return &Hub{clients: make(map[*websocket.Conn]bool)}
}

// Broadcast serialises msg and sends it to every connected client.
// Write errors are logged but do not remove the connection; the next
// read from the client will detect the broken pipe and clean it up.
func (h *Hub) Broadcast(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			slog.Debug("WebSocket write error", "error", err)
		}
	}
}

// BroadcastRaw is a convenience wrapper that marshals payload to JSON
// and broadcasts it as a WSMessage with the given type string.
func (h *Hub) BroadcastRaw(msgType string, payload any) {
	p, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.Broadcast(WSMessage{Type: msgType, Payload: p})
}

// ServeWS upgrades the HTTP connection to WebSocket, registers the client,
// sends the current full state immediately, then enters a read loop that
// dispatches incoming action messages to srv.handleWSMessage.
// The client is removed from the hub when the connection closes.
func (h *Hub) ServeWS(srv *Server, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("WebSocket upgrade error", "error", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()

	// Send current state on connect
	state := srv.state.GetState()
	p, _ := json.Marshal(state)
	_ = conn.WriteMessage(websocket.TextMessage, mustMarshal(WSMessage{Type: "state_update", Payload: p}))

	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		srv.handleWSMessage(msg)
	}
}

// CloseAll sends a normal-closure frame to every client and removes them
// from the hub. Called during graceful shutdown so http.Server.Shutdown
// does not wait for idle WebSocket connections to time out.
func (h *Hub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, "server shutting down"))
		conn.Close()
	}
	h.clients = make(map[*websocket.Conn]bool)
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
