package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestOriginPolicyAllows covers the origin allowlist for both dev and
// production, including the cross-site origins that must be rejected.
func TestOriginPolicyAllows(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		devMode bool
		tlsPort int
		want    bool
	}{
		{"empty origin (native client)", "", false, 0, true},
		{"electron renderer", "encounty://app", false, 0, true},
		{"own origin via localhost", "http://localhost:8192", false, 0, true},
		{"own origin via 127.0.0.1", "http://127.0.0.1:8192", false, 0, true},
		{"own origin via ipv6 loopback", "http://[::1]:8192", false, 0, true},
		{"vite dev server in dev mode", "http://localhost:5173", true, 0, true},
		{"vite dev server in prod mode", "http://localhost:5173", false, 0, false},
		{"other local port", "http://localhost:3000", false, 0, false},
		{"remote site", "https://evil.example", false, 0, false},
		{"remote site on same port", "http://evil.example:8192", false, 0, false},
		{"https on own port", "https://localhost:8192", false, 0, false},
		{"opaque origin", "null", false, 0, false},
		{"foreign electron host", "encounty://evil", false, 0, false},
		{"malformed", "http://[::1", false, 0, false},
		{"tls origin via localhost", "https://localhost:8193", false, 8193, true},
		{"tls origin via 127.0.0.1", "https://127.0.0.1:8193", false, 8193, true},
		{"tls origin via ipv6 loopback", "https://[::1]:8193", false, 8193, true},
		{"https on the http port", "https://localhost:8192", false, 8193, false},
		{"https on a foreign port", "https://localhost:9443", false, 8193, false},
		{"https on the dev server port", "https://localhost:5173", true, 8193, false},
		{"remote site on the tls port", "https://evil.example:8193", false, 8193, false},
		{"tls origin while tls is off", "https://localhost:8193", false, 0, false},
		{"https on port zero", "https://localhost:0", false, 0, false},
		{"plain http on the tls port", "http://localhost:8193", false, 8193, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := originPolicy{port: 8192, devMode: tt.devMode, tlsPort: tt.tlsPort}
			if got := p.allows(tt.origin); got != tt.want {
				t.Errorf("allows(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

// TestOriginPolicyAllowsHost covers the Host header check, which has no scheme
// to go by and therefore accepts either of this instance's ports.
func TestOriginPolicyAllowsHost(t *testing.T) {
	tests := []struct {
		name    string
		host    string
		tlsPort int
		want    bool
	}{
		{"http port", "localhost:8192", 8193, true},
		{"tls port", "localhost:8193", 8193, true},
		{"tls port while tls is off", "localhost:8193", 0, false},
		{"foreign port", "localhost:9443", 8193, false},
		{"rebound host on the tls port", "attacker.example:8193", 8193, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := originPolicy{port: 8192, tlsPort: tt.tlsPort}
			if got := p.allowsHost(tt.host); got != tt.want {
				t.Errorf("allowsHost(%q) = %v, want %v", tt.host, got, tt.want)
			}
		})
	}
}

// TestCorsMiddlewareRejectsCrossOriginMutation verifies that the body-less
// hotkey POST a foreign page could send is refused, while safe methods from the
// same origin keep working.
func TestCorsMiddlewareRejectsCrossOriginMutation(t *testing.T) {
	tests := []struct {
		name   string
		method string
		origin string
		want   int
	}{
		{"cross-origin POST", http.MethodPost, "https://evil.example", http.StatusForbidden},
		{"cross-origin DELETE", http.MethodDelete, "https://evil.example", http.StatusForbidden},
		{"cross-origin GET stays allowed", http.MethodGet, "https://evil.example", http.StatusOK},
		{"same-origin POST", http.MethodPost, "http://localhost:8192", http.StatusOK},
		{"native POST without origin", http.MethodPost, "", http.StatusOK},
		{"electron POST", http.MethodPost, "encounty://app", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})
			handler := corsMiddleware(inner, originPolicy{port: 8192})

			req := httptest.NewRequest(tt.method, "/api/hotkeys/trigger/increment", nil)
			req.Host = "localhost:8192"
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != tt.want {
				t.Errorf(srvFmtStatus, w.Code, tt.want)
			}
			if wantCalled := tt.want == http.StatusOK; called != wantCalled {
				t.Errorf("inner handler called = %v, want %v", called, wantCalled)
			}
		})
	}
}
