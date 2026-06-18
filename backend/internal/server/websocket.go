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

const sendBufSize = 256

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
// write channel. It favours the latest message: when a client's send buffer is
// full it drains one stale message (non-blocking) and enqueues the new one, so
// the freshest message is never the one dropped. This is correct because a
// state_update is an idempotent full snapshot, so keeping the newest is enough.
// All operations are non-blocking, so a slow client never stalls the broadcaster.
func (h *Hub) Broadcast(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	payload := wsPayload{data: data, msgType: websocket.TextMessage}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- payload:
		default:
			// Buffer full: drop the oldest queued message and keep the newest.
			select {
			case <-c.send:
			default:
			}
			select {
			case c.send <- payload:
			default:
				// A concurrent writer refilled the buffer; skip rather than block.
				slog.Debug("WebSocket send buffer full, dropping stale message")
			}
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

	// Enqueue the initial state snapshot while holding the hub lock so the send
	// cannot race with CloseAll closing the channel. The buffer has spare
	// capacity, so this never blocks.
	state := srv.state.GetState()
	p, _ := json.Marshal(state)
	h.mu.Lock()
	h.clients[c] = true
	c.send <- wsPayload{data: mustMarshal(WSMessage{Type: "state_update", Payload: p}), msgType: websocket.TextMessage}
	h.mu.Unlock()

	// Start the write goroutine.
	go c.writePump()

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
