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
		want    bool
	}{
		{"empty origin (native client)", "", false, true},
		{"electron renderer", "encounty://app", false, true},
		{"own origin via localhost", "http://localhost:8192", false, true},
		{"own origin via 127.0.0.1", "http://127.0.0.1:8192", false, true},
		{"own origin via ipv6 loopback", "http://[::1]:8192", false, true},
		{"vite dev server in dev mode", "http://localhost:5173", true, true},
		{"vite dev server in prod mode", "http://localhost:5173", false, false},
		{"other local port", "http://localhost:3000", false, false},
		{"remote site", "https://evil.example", false, false},
		{"remote site on same port", "http://evil.example:8192", false, false},
		{"https on own port", "https://localhost:8192", false, false},
		{"opaque origin", "null", false, false},
		{"foreign electron host", "encounty://evil", false, false},
		{"malformed", "http://[::1", false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := originPolicy{port: 8192, devMode: tt.devMode}
			if got := p.allows(tt.origin); got != tt.want {
				t.Errorf("allows(%q) = %v, want %v", tt.origin, got, tt.want)
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
