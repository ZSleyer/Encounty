// tls.go adds a second, TLS-terminated listener next to the plain HTTP one.
//
// Its whole purpose is HTTP/2. The dex page requests around 1500 sprites while
// scrolling, and over HTTP/1.1 the browser's six connections per origin turn
// that into a queue: most of the time per request is spent waiting for a free
// connection. HTTP/2 multiplexes them over one connection, but no browser
// speaks cleartext h2c, so the endpoint has to be TLS even on loopback.
//
// The plain HTTP listener stays exactly as it was. The OBS browser source
// cannot dismiss a certificate warning for a self-signed certificate, and the
// Vite dev server talks to the same API, so HTTP is not optional.

package server

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"

	"github.com/zsleyer/encounty/backend/internal/tlscert"
)

// StartTLS prepares the TLS listener: it loads or creates the loopback
// certificate under the config directory and binds 127.0.0.1 on the TLS port.
// It must run before Start, which serves whatever this bound.
//
// Every failure is soft. A backend that refuses to start because it could not
// write a certificate would cost the user their whole app, while the only
// thing lost here is the faster sprite loading. The endpoint is advertised
// through /api/version only once the bind succeeded, so a client never pins a
// port that nothing is listening on.
func (s *Server) StartTLS() {
	if s.mux == nil {
		return // constructed outside New, as the tests do
	}

	cert, fingerprint, err := tlscert.EnsureCertificate(s.ConfigDir())
	if err != nil {
		slog.Warn("TLS certificate unavailable, serving plain HTTP only", "error", err)
		return
	}

	port := tlsPortFor(s.port)
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	// Loopback only, deliberately: the certificate is trusted by pinning on
	// this machine, and the API has no business being reachable from the
	// network.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		slog.Warn("TLS port unavailable, serving plain HTTP only", "addr", addr, "error", err)
		return
	}

	s.tlsPort = port
	s.tlsFingerprint = fingerprint
	s.tlsListener = ln

	// The origin policy learns the TLS port only now. Trusting port+1 up front
	// would hand that trust to whatever foreign process holds the port when
	// the bind above fails, and the policy exists precisely to not trust other
	// local tools.
	s.origins.tlsPort = port
	s.httpServer.Handler = corsMiddleware(s.mux, s.origins)

	s.tlsServer = &http.Server{
		Addr:    addr,
		Handler: corsMiddleware(s.mux, s.origins),
		// NextProtos is left unset on purpose: http.Server adds "h2" through
		// ALPN in ServeTLS, and setting the list by hand is the usual way to
		// silently end up on HTTP/1.1.
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		},
	}

	slog.Info("TLS listener ready", "addr", addr, "fingerprint", fingerprint)
}

// serveTLS runs the TLS server until shutdown. ServeTLS, not Serve over a
// tls.NewListener: only ServeTLS configures ALPN for HTTP/2, and without it
// the listener would quietly serve HTTP/1.1 and defeat the point.
func (s *Server) serveTLS() {
	// The certificate comes from TLSConfig, so both path arguments stay empty.
	if err := s.tlsServer.ServeTLS(s.tlsListener, "", ""); err != nil && err != http.ErrServerClosed {
		slog.Warn("TLS listener stopped, plain HTTP is unaffected", "error", err)
	}
}

// shutdownTLS stops the TLS server if one is running.
func (s *Server) shutdownTLS(ctx context.Context) {
	if s.tlsServer == nil {
		return
	}
	if err := s.tlsServer.Shutdown(ctx); err != nil {
		slog.Warn("TLS shutdown error", "error", err)
	}
}

// TLSInfo returns the port of the TLS listener and the lowercase hex SHA-256
// fingerprint of its certificate. The port is 0 and the fingerprint empty when
// TLS is unavailable.
func (s *Server) TLSInfo() (port int, fingerprint string) {
	return s.tlsPort, s.tlsFingerprint
}
