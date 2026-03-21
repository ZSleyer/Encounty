// websocket.go implements the WebSocket hub that maintains active client
// connections and routes messages between the server and all browser tabs.
// On every state mutation the hub broadcasts a "state_update" message so
// all connected clients stay in sync without polling.
//
// Each connection has a dedicated write goroutine that serialises all
// outgoing messages through a channel, preventing concurrent writes to
// the same gorilla/websocket.Conn (which would panic).
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

// wsPayload pairs raw bytes with a WebSocket message type so the write pump
// can send both text (JSON) and binary (preview frames) messages.
type wsPayload struct {
	data    []byte
	msgType int // websocket.TextMessage or websocket.BinaryMessage
}

// wsClient wraps a single WebSocket connection with a buffered send channel.
// The writePump goroutine drains the channel and performs the actual writes,
// ensuring only one goroutine writes to the connection at a time.
type wsClient struct {
	conn *websocket.Conn
	send chan wsPayload
}

const sendBufSize = 64

// writePump runs in its own goroutine and serialises all writes to conn.
// It supports both text and binary message types via the wsPayload envelope.
func (c *wsClient) writePump() {
	defer func() { _ = c.conn.Close() }()
	for msg := range c.send {
		if err := c.conn.WriteMessage(msg.msgType, msg.data); err != nil {
			slog.Debug("WebSocket write error", "error", err)
			return
		}
	}
	// Channel closed — send a close frame.
	_ = c.conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, "server shutting down"))
}

// Hub tracks all active WebSocket connections. A read/write mutex guards the
// clients map so Broadcast can safely iterate while ServeWS may concurrently
// add or remove connections.
type Hub struct {
	mu      sync.RWMutex
	clients map[*wsClient]bool
}

// NewHub creates an empty Hub ready to accept connections.
func NewHub() *Hub {
	return &Hub{clients: make(map[*wsClient]bool)}
}

// Broadcast serialises msg and sends it to every connected client via their
// write channel. If a client's buffer is full the message is dropped to
// avoid blocking the broadcaster.
func (h *Hub) Broadcast(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- wsPayload{data: data, msgType: websocket.TextMessage}:
		default:
			// Client too slow — drop message to avoid blocking.
			slog.Debug("WebSocket send buffer full, dropping message")
		}
	}
}

// BroadcastBinary sends raw binary data to every connected client as a
// WebSocket binary message. Used for streaming preview frames.
func (h *Hub) BroadcastBinary(data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- wsPayload{data: data, msgType: websocket.BinaryMessage}:
		default:
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

	c := &wsClient{
		conn: conn,
		send: make(chan wsPayload, sendBufSize),
	}

	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	// Start the write goroutine.
	go c.writePump()

	// Send current state on connect.
	state := srv.state.GetState()
	p, _ := json.Marshal(state)
	c.send <- wsPayload{data: mustMarshal(WSMessage{Type: "state_update", Payload: p}), msgType: websocket.TextMessage}

	defer func() {
		h.mu.Lock()
		// Only close the channel if we're still tracked (CloseAll may have already done it).
		if h.clients[c] {
			delete(h.clients, c)
			close(c.send)
		}
		h.mu.Unlock()
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

// CloseAll closes every client connection and removes them from the hub.
// Called during graceful shutdown so http.Server.Shutdown does not wait
// for idle WebSocket connections to time out.
func (h *Hub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		close(c.send) // triggers writePump to send close frame and exit
	}
	h.clients = make(map[*wsClient]bool)
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
