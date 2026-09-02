package server

import (
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/zsleyer/encounty/backend/internal/state"
)

// newTLSTestServer builds a Server through New on a port pair that is free,
// so StartTLS can bind the TLS port next to it.
func newTLSTestServer(t *testing.T) *Server {
	t.Helper()
	port := freePortPair(t)
	return New(Config{
		Port:      port,
		State:     state.NewManager(t.TempDir()),
		HotkeyMgr: newMockHotkeyMgr(),
	})
}

// freePortPair returns a port p for which both p and p+1 are currently free.
func freePortPair(t *testing.T) int {
	t.Helper()
	for attempt := 0; attempt < 20; attempt++ {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		port := ln.Addr().(*net.TCPAddr).Port
		_ = ln.Close()

		next, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", tlsPortFor(port)))
		if err != nil {
			continue
		}
		_ = next.Close()
		return port
	}
	t.Skip("no free consecutive port pair available")
	return 0
}

// TestStartTLSServesHTTP2 is the point of the whole listener: a browser-shaped
// client must negotiate h2 over ALPN. Serving the same handler over
// tls.NewListener would pass every other test here and still speak HTTP/1.1.
func TestStartTLSServesHTTP2(t *testing.T) {
	srv := newTLSTestServer(t)
	srv.StartTLS()
	if srv.tlsListener == nil {
		t.Fatal("StartTLS did not bind a listener")
	}
	go srv.serveTLS()
	t.Cleanup(func() { _ = srv.tlsServer.Close() })

	port, fingerprint := srv.TLSInfo()
	if port != tlsPortFor(srv.port) {
		t.Errorf("TLS port = %d, want %d", port, tlsPortFor(srv.port))
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			// The certificate is self-signed and pinned by fingerprint, which
			// this test verifies below instead of trusting a chain.
			TLSClientConfig:   &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12},
			ForceAttemptHTTP2: true,
		},
	}
	resp, err := client.Get(fmt.Sprintf("https://127.0.0.1:%d/api/version", port))
	if err != nil {
		t.Fatalf("GET over TLS: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.Proto != "HTTP/2.0" {
		t.Errorf("negotiated protocol = %q, want HTTP/2.0", resp.Proto)
	}
	if resp.TLS == nil || len(resp.TLS.PeerCertificates) == 0 {
		t.Fatal("no peer certificate presented")
	}
	sum := sha256.Sum256(resp.TLS.PeerCertificates[0].Raw)
	if got := hex.EncodeToString(sum[:]); got != fingerprint {
		t.Errorf("served certificate fingerprint = %s, advertised %s", got, fingerprint)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var payload struct {
		TLSPort        int    `json:"tls_port"`
		TLSFingerprint string `json:"tls_fingerprint"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload.TLSPort != port {
		t.Errorf("advertised tls_port = %d, want %d", payload.TLSPort, port)
	}
	if payload.TLSFingerprint != fingerprint {
		t.Errorf("advertised tls_fingerprint = %q, want %q", payload.TLSFingerprint, fingerprint)
	}
}

// TestStartTLSTrustsTLSOriginOnlyAfterBind covers the trust boundary: the
// origin policy must not accept an https origin on the TLS port before that
// port is ours.
func TestStartTLSTrustsTLSOriginOnlyAfterBind(t *testing.T) {
	srv := newTLSTestServer(t)
	httpsOrigin := fmt.Sprintf("https://127.0.0.1:%d", tlsPortFor(srv.port))

	if srv.origins.allows(httpsOrigin) {
		t.Error("https origin accepted before the TLS listener was bound")
	}

	srv.StartTLS()
	t.Cleanup(func() {
		if srv.tlsListener != nil {
			_ = srv.tlsListener.Close()
		}
	})

	if !srv.origins.allows(httpsOrigin) {
		t.Error("https origin rejected after the TLS listener was bound")
	}
}

// TestTLSInfoWithoutListener documents what /api/version reports when TLS
// could not be set up.
func TestTLSInfoWithoutListener(t *testing.T) {
	srv := newTestServer(t)
	port, fingerprint := srv.TLSInfo()
	if port != 0 || fingerprint != "" {
		t.Errorf("TLSInfo() = (%d, %q), want (0, \"\")", port, fingerprint)
	}
}
