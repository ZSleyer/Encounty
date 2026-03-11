package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestHubNewHub verifies that a freshly created hub has no clients.
func TestHubNewHub(t *testing.T) {
	h := NewHub()
	if h == nil {
		t.Fatal("NewHub returned nil")
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	if len(h.clients) != 0 {
		t.Errorf("new hub has %d clients, want 0", len(h.clients))
	}
}

// TestHubBroadcastNoClients ensures Broadcast does not panic with zero clients.
func TestHubBroadcastNoClients(t *testing.T) {
	h := NewHub()
	h.Broadcast(WSMessage{Type: "test", Payload: json.RawMessage(`{}`)})
}

// TestHubBroadcastMultipleClients verifies that Broadcast delivers messages
// to every registered client's send channel.
func TestHubBroadcastMultipleClients(t *testing.T) {
	h := NewHub()

	const numClients = 3
	clients := make([]*wsClient, numClients)
	for i := range clients {
		clients[i] = &wsClient{send: make(chan []byte, sendBufSize)}
		h.mu.Lock()
		h.clients[clients[i]] = true
		h.mu.Unlock()
	}

	msg := WSMessage{Type: "test_broadcast", Payload: json.RawMessage(`{"key":"value"}`)}
	h.Broadcast(msg)

	for i, c := range clients {
		select {
		case data := <-c.send:
			var got WSMessage
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatalf("client %d: unmarshal: %v", i, err)
			}
			if got.Type != "test_broadcast" {
				t.Errorf("client %d: type = %q, want %q", i, got.Type, "test_broadcast")
			}
		default:
			t.Errorf("client %d: no message received", i)
		}
	}
}

// TestHubBroadcastRaw verifies BroadcastRaw marshals payload into a WSMessage.
func TestHubBroadcastRaw(t *testing.T) {
	h := NewHub()
	c := &wsClient{send: make(chan []byte, sendBufSize)}
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	payload := map[string]string{"hello": "world"}
	h.BroadcastRaw("raw_test", payload)

	select {
	case data := <-c.send:
		var got WSMessage
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if got.Type != "raw_test" {
			t.Errorf("type = %q, want %q", got.Type, "raw_test")
		}
		var p map[string]string
		if err := json.Unmarshal(got.Payload, &p); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if p["hello"] != "world" {
			t.Errorf("payload[hello] = %q, want %q", p["hello"], "world")
		}
	default:
		t.Error("no message received")
	}
}

// TestHubBroadcastDropsSlowClient verifies that a client with a full send
// buffer does not block the broadcaster.
func TestHubBroadcastDropsSlowClient(t *testing.T) {
	h := NewHub()

	// Create a client with a tiny buffer and fill it.
	slow := &wsClient{send: make(chan []byte, 1)}
	slow.send <- []byte("filler")

	fast := &wsClient{send: make(chan []byte, sendBufSize)}

	h.mu.Lock()
	h.clients[slow] = true
	h.clients[fast] = true
	h.mu.Unlock()

	msg := WSMessage{Type: "test", Payload: json.RawMessage(`{}`)}
	h.Broadcast(msg)

	// Fast client should still receive the message.
	select {
	case <-fast.send:
		// ok
	default:
		t.Error("fast client did not receive message")
	}
}

// TestHubCloseAll verifies that CloseAll empties the client map and closes
// all send channels.
func TestHubCloseAll(t *testing.T) {
	h := NewHub()

	const numClients = 3
	channels := make([]chan []byte, numClients)
	for i := range channels {
		ch := make(chan []byte, sendBufSize)
		channels[i] = ch
		c := &wsClient{send: ch}
		h.mu.Lock()
		h.clients[c] = true
		h.mu.Unlock()
	}

	h.CloseAll()

	h.mu.RLock()
	count := len(h.clients)
	h.mu.RUnlock()
	if count != 0 {
		t.Errorf("after CloseAll: %d clients, want 0", count)
	}

	// Verify all send channels are closed.
	for i, ch := range channels {
		select {
		case _, ok := <-ch:
			if ok {
				t.Errorf("client %d channel still open", i)
			}
		default:
			t.Errorf("client %d channel not closed", i)
		}
	}
}

// TestWSIntegration connects a real gorilla/websocket client to an httptest
// server and verifies the initial state_update delivery plus round-trip
// message handling.
func TestWSIntegration(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Bulbasaur")
	srv.state.SetActive("p1")

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		srv.hub.ServeWS(srv, w, r)
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	dialer := websocket.Dialer{}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// The server should send the current state immediately on connect.
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read initial state: %v", err)
	}

	var initMsg WSMessage
	if err := json.Unmarshal(data, &initMsg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if initMsg.Type != "state_update" {
		t.Errorf("initial message type = %q, want %q", initMsg.Type, "state_update")
	}

	// Send an increment action over the WebSocket.
	actionMsg := WSMessage{
		Type:    "increment",
		Payload: json.RawMessage(`{"pokemon_id":"p1"}`),
	}
	if err := conn.WriteJSON(actionMsg); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Read the resulting state_update broadcast.
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("read broadcast: %v", err)
	}
	var broadcastMsg WSMessage
	if err := json.Unmarshal(data, &broadcastMsg); err != nil {
		t.Fatalf("unmarshal broadcast: %v", err)
	}

	// We might receive an encounter_added or state_update; both indicate success.
	validTypes := map[string]bool{"state_update": true, "encounter_added": true}
	if !validTypes[broadcastMsg.Type] {
		t.Errorf("broadcast type = %q, want one of %v", broadcastMsg.Type, validTypes)
	}

	// Verify the state was actually mutated.
	st := srv.state.GetState()
	if len(st.Pokemon) == 0 {
		t.Fatal("no pokemon in state")
	}
	if st.Pokemon[0].Encounters != 1 {
		t.Errorf("encounters = %d, want 1", st.Pokemon[0].Encounters)
	}
}

// TestWSMultipleClients verifies that a broadcast reaches all connected WS
// clients.
func TestWSMultipleClients(t *testing.T) {
	srv := newTestServer(t)
	addTestPokemon(t, srv, "p1", "Eevee")

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		srv.hub.ServeWS(srv, w, r)
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	dialer := websocket.Dialer{}

	const numClients = 3
	conns := make([]*websocket.Conn, numClients)
	for i := range conns {
		c, _, err := dialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("client %d dial: %v", i, err)
		}
		defer c.Close()
		conns[i] = c

		// Drain the initial state_update.
		c.SetReadDeadline(time.Now().Add(2 * time.Second))
		if _, _, err := c.ReadMessage(); err != nil {
			t.Fatalf("client %d initial read: %v", i, err)
		}
	}

	// Broadcast a custom message and verify all clients receive it.
	srv.hub.BroadcastRaw("ping", map[string]int{"seq": 42})

	var wg sync.WaitGroup
	wg.Add(numClients)
	for i, c := range conns {
		go func(idx int, conn *websocket.Conn) {
			defer wg.Done()
			conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			_, data, err := conn.ReadMessage()
			if err != nil {
				t.Errorf("client %d read: %v", idx, err)
				return
			}
			var msg WSMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				t.Errorf("client %d unmarshal: %v", idx, err)
				return
			}
			if msg.Type != "ping" {
				t.Errorf("client %d type = %q, want %q", idx, msg.Type, "ping")
			}
		}(i, c)
	}
	wg.Wait()
}

// TestWSClientDisconnect verifies that a disconnected client is removed from
// the hub.
func TestWSClientDisconnect(t *testing.T) {
	srv := newTestServer(t)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		srv.hub.ServeWS(srv, w, r)
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	// Wait for registration.
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read initial: %v", err)
	}

	srv.hub.mu.RLock()
	before := len(srv.hub.clients)
	srv.hub.mu.RUnlock()
	if before != 1 {
		t.Fatalf("before disconnect: %d clients, want 1", before)
	}

	conn.Close()

	// Give the server time to detect the disconnect and clean up.
	time.Sleep(100 * time.Millisecond)

	srv.hub.mu.RLock()
	after := len(srv.hub.clients)
	srv.hub.mu.RUnlock()
	if after != 0 {
		t.Errorf("after disconnect: %d clients, want 0", after)
	}
}
