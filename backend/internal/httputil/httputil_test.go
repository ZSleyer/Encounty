// httputil_test.go contains tests for the httputil package covering JSON
// reading/writing, path extraction helpers, and outgoing HTTP fetch utilities.
package httputil

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	headerContentType = "Content-Type"
	mimeJSON          = "application/json"
	fmtWantJSON       = "expected Content-Type application/json, got %q"
	fmtUnexpectedErr  = "unexpected error: %v"
	pathAPIPokemon    = "/api/pokemon/"
	idABC123          = "abc-123"
	errInner          = "inner error"
)

// --- WriteJSON ---

// TestWriteJSONSuccess verifies that WriteJSON sets the correct status code,
// content type header, and encodes the value as JSON.
func TestWriteJSONSuccess(t *testing.T) {
	t.Helper()

	rec := httptest.NewRecorder()
	payload := map[string]string{"key": "value"}

	WriteJSON(rec, http.StatusOK, payload)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	if ct := rec.Header().Get(headerContentType); ct != mimeJSON {
		t.Fatalf(fmtWantJSON, ct)
	}

	var got map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got["key"] != "value" {
		t.Fatalf("expected key=value, got key=%q", got["key"])
	}
}

// TestWriteJSONCustomStatus verifies non-200 status codes are forwarded.
func TestWriteJSONCustomStatus(t *testing.T) {
	t.Helper()

	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusCreated, ErrResp{Error: "none"})

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, rec.Code)
	}
}

// TestWriteJSONNilValue writes a JSON null when v is nil.
func TestWriteJSONNilValue(t *testing.T) {
	t.Helper()

	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, nil)

	body := strings.TrimSpace(rec.Body.String())
	if body != "null" {
		t.Fatalf("expected null, got %q", body)
	}
}

// --- ReadJSON ---

// TestReadJSONSuccess decodes a valid JSON body.
func TestReadJSONSuccess(t *testing.T) {
	t.Helper()

	body := `{"name":"Pikachu","count":42}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))

	var got struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	if err := ReadJSON(req, &got); err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if got.Name != "Pikachu" || got.Count != 42 {
		t.Fatalf("unexpected result: %+v", got)
	}
}

// TestReadJSONInvalidJSON returns an error for malformed input.
func TestReadJSONInvalidJSON(t *testing.T) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{invalid"))
	var got map[string]string
	if err := ReadJSON(req, &got); err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

// TestReadJSONEmptyBody returns an error for an empty body.
func TestReadJSONEmptyBody(t *testing.T) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	var got map[string]string
	if err := ReadJSON(req, &got); err == nil {
		t.Fatal("expected error for empty body, got nil")
	}
}

// --- PokemonIDFromPath / IDFromPath ---

// TestPokemonIDFromPath covers typical path extraction scenarios.
func TestPokemonIDFromPath(t *testing.T) {
	t.Helper()

	tests := []struct {
		name   string
		path   string
		prefix string
		suffix string
		want   string
	}{
		{
			name:   "standard path with action suffix",
			path:   pathAPIPokemon + idABC123 + "/increment",
			prefix: pathAPIPokemon,
			suffix: "/increment",
			want:   idABC123,
		},
		{
			name:   "path without suffix",
			path:   pathAPIPokemon + idABC123,
			prefix: pathAPIPokemon,
			suffix: "",
			want:   idABC123,
		},
		{
			name:   "trailing slash stripped",
			path:   pathAPIPokemon + idABC123 + "/",
			prefix: pathAPIPokemon,
			suffix: "",
			want:   idABC123,
		},
		{
			name:   "empty after stripping",
			path:   pathAPIPokemon,
			prefix: pathAPIPokemon,
			suffix: "",
			want:   "",
		},
		{
			name:   "prefix not found leaves path unchanged",
			path:   "/other/xyz",
			prefix: pathAPIPokemon,
			suffix: "",
			want:   "other/xyz",
		},
		{
			name:   "suffix with nested path",
			path:   "/api/detector/det-1/template/2",
			prefix: "/api/detector/",
			suffix: "/template/2",
			want:   "det-1",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := PokemonIDFromPath(tc.path, tc.prefix, tc.suffix)
			if got != tc.want {
				t.Fatalf("PokemonIDFromPath(%q, %q, %q) = %q, want %q",
					tc.path, tc.prefix, tc.suffix, got, tc.want)
			}
		})
	}
}

// TestIDFromPathDelegatesToPokemonIDFromPath verifies that IDFromPath returns
// the same result as PokemonIDFromPath.
func TestIDFromPathDelegatesToPokemonIDFromPath(t *testing.T) {
	t.Helper()

	path := "/api/stats/pokemon/abc-123"
	prefix := "/api/stats/pokemon/"
	suffix := ""

	got := IDFromPath(path, prefix, suffix)
	want := PokemonIDFromPath(path, prefix, suffix)
	if got != want {
		t.Fatalf("IDFromPath = %q, PokemonIDFromPath = %q", got, want)
	}
}

// --- ErrResp ---

// TestErrRespJSONRoundTrip verifies that ErrResp marshals with the "error" key.
func TestErrRespJSONRoundTrip(t *testing.T) {
	t.Helper()

	original := ErrResp{Error: "not found"}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded ErrResp
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Error != original.Error {
		t.Fatalf("expected %q, got %q", original.Error, decoded.Error)
	}

	// Verify the JSON key name is "error".
	var raw map[string]string
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal raw: %v", err)
	}
	if _, ok := raw["error"]; !ok {
		t.Fatal("expected JSON key \"error\" to be present")
	}
}

// --- parseRetryAfter ---

// TestParseRetryAfter covers various Retry-After header values.
func TestParseRetryAfter(t *testing.T) {
	t.Helper()

	tests := []struct {
		name   string
		header string
		want   time.Duration
	}{
		{name: "empty returns default", header: "", want: defaultRetryAfter},
		{name: "valid seconds", header: "10", want: 10 * time.Second},
		{name: "one second", header: "1", want: 1 * time.Second},
		{name: "non-numeric returns default", header: "abc", want: defaultRetryAfter},
		{name: "zero returns default", header: "0", want: defaultRetryAfter},
		{name: "negative returns default", header: "-5", want: defaultRetryAfter},
		{name: "float returns default", header: "1.5", want: defaultRetryAfter},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parseRetryAfter(tc.header)
			if got != tc.want {
				t.Fatalf("parseRetryAfter(%q) = %v, want %v", tc.header, got, tc.want)
			}
		})
	}
}

// --- FetchJSON / GetJSON / PostJSON ---

// newTestServer creates an httptest.Server that returns the given status code
// and JSON body. The caller must use t.Cleanup to close it.
func newTestServer(t *testing.T, status int, body any) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(headerContentType, mimeJSON)
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// TestGetJSONSuccess performs a successful GET and decodes the response.
func TestGetJSONSuccess(t *testing.T) {
	t.Helper()

	srv := newTestServer(t, http.StatusOK, map[string]string{"hello": "world"})

	var got map[string]string
	if err := GetJSON(srv.URL, &got); err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if got["hello"] != "world" {
		t.Fatalf("expected hello=world, got %v", got)
	}
}

// TestPostJSONSuccess posts JSON and decodes the response.
func TestPostJSONSuccess(t *testing.T) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if ct := r.Header.Get(headerContentType); ct != mimeJSON {
			t.Errorf(fmtWantJSON, ct)
		}

		var in map[string]int
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Errorf("decode request body: %v", err)
		}

		w.Header().Set(headerContentType, mimeJSON)
		_ = json.NewEncoder(w).Encode(map[string]int{"doubled": in["n"] * 2})
	}))
	t.Cleanup(srv.Close)

	reqBody, _ := json.Marshal(map[string]int{"n": 21})
	var got map[string]int
	if err := PostJSON(srv.URL, bytes.NewReader(reqBody), &got); err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if got["doubled"] != 42 {
		t.Fatalf("expected doubled=42, got %v", got)
	}
}

// TestFetchJSON404ReturnsNonRetryableError verifies that a 4xx (non-429) error
// is returned immediately without retries.
func TestFetchJSON404ReturnsNonRetryableError(t *testing.T) {
	t.Helper()

	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)

	var got any
	err := GetJSON(srv.URL, &got)
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if callCount != 1 {
		t.Fatalf("expected 1 request (no retries), got %d", callCount)
	}
	if !strings.Contains(err.Error(), "404") {
		t.Fatalf("expected error to mention 404, got %q", err.Error())
	}
}

// TestFetchJSON429RetriesAndSucceeds verifies rate-limit handling. The
// server returns 429 twice and then succeeds on the third attempt.
func TestFetchJSON429RetriesAndSucceeds(t *testing.T) {
	t.Helper()

	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		if callCount < 3 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Header().Set(headerContentType, mimeJSON)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}))
	t.Cleanup(srv.Close)

	var got map[string]bool
	err := FetchJSON(srv.URL, http.MethodGet, nil, &got)
	if err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if !got["ok"] {
		t.Fatal("expected ok=true after retries")
	}
	if callCount != 3 {
		t.Fatalf("expected 3 attempts (2 retries), got %d", callCount)
	}
}

// TestFetchJSON5xxReturnsRetryableError verifies that server errors produce a
// retryableError.
func TestFetchJSON5xxReturnsRetryableError(t *testing.T) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	var got any
	err := FetchJSON(srv.URL, http.MethodGet, nil, &got)
	if err == nil {
		t.Fatal("expected error for 500, got nil")
	}

	var re *retryableError
	if !errors.As(err, &re) {
		t.Fatalf("expected retryableError, got %T: %v", err, err)
	}
	if !strings.Contains(err.Error(), "500") {
		t.Fatalf("expected error to mention 500, got %q", err.Error())
	}
}

// TestFetchJSONInvalidURL returns an error for an unreachable host.
func TestFetchJSONInvalidURL(t *testing.T) {
	t.Helper()

	var got any
	err := FetchJSON("http://127.0.0.1:0/nonexistent", http.MethodGet, nil, &got)
	if err == nil {
		t.Fatal("expected error for invalid URL, got nil")
	}
}

// TestFetchJSONBodyReadError verifies that a failing body reader is handled.
func TestFetchJSONBodyReadError(t *testing.T) {
	t.Helper()

	var got any
	err := FetchJSON("http://localhost:0", http.MethodPost, &failReader{}, &got)
	if err == nil {
		t.Fatal("expected error for failing body reader, got nil")
	}
	if !strings.Contains(err.Error(), "read request body") {
		t.Fatalf("expected body read error, got %q", err.Error())
	}
}

// failReader is an io.Reader that always returns an error.
type failReader struct{}

func (f *failReader) Read([]byte) (int, error) {
	return 0, errors.New("simulated read failure")
}

// TestFetchJSONInvalidResponseJSON verifies that a 200 with non-JSON body
// returns an unmarshal error.
func TestFetchJSONInvalidResponseJSON(t *testing.T) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not json"))
	}))
	t.Cleanup(srv.Close)

	var got map[string]string
	err := GetJSON(srv.URL, &got)
	if err == nil {
		t.Fatal("expected unmarshal error, got nil")
	}
}

// TestFetchJSONNilBody verifies GET requests work without a body.
func TestFetchJSONNilBody(t *testing.T) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(headerContentType) != "" {
			t.Error("expected no Content-Type for nil body")
		}
		w.Header().Set(headerContentType, mimeJSON)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)

	var got map[string]bool
	if err := FetchJSON(srv.URL, http.MethodGet, nil, &got); err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if !got["ok"] {
		t.Fatal("expected ok=true")
	}
}

// TestRetryableErrorUnwrap verifies that the underlying error can be extracted.
func TestRetryableErrorUnwrap(t *testing.T) {
	t.Helper()

	inner := errors.New(errInner)
	re := &retryableError{err: inner}

	if re.Error() != errInner {
		t.Fatalf("Error() = %q, want %q", re.Error(), errInner)
	}
	if !errors.Is(re, inner) {
		t.Fatal("expected errors.Is to match inner error")
	}
}

// TestDoFetchJSONSetsContentTypeForBody verifies that Content-Type is set when
// a body is provided.
func TestDoFetchJSONSetsContentTypeForBody(t *testing.T) {
	t.Helper()

	var gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCT = r.Header.Get(headerContentType)
		w.Header().Set(headerContentType, mimeJSON)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	client := &http.Client{Timeout: 5 * time.Second}
	var got map[string]any
	_ = doFetchJSON(client, srv.URL, http.MethodPost, strings.NewReader(`{}`), &got)

	if gotCT != mimeJSON {
		t.Fatalf(fmtWantJSON, gotCT)
	}
}

// TestDoFetchJSONNoContentTypeForNilBody verifies that Content-Type is not set
// when body is nil.
func TestDoFetchJSONNoContentTypeForNilBody(t *testing.T) {
	t.Helper()

	var gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCT = r.Header.Get(headerContentType)
		w.Header().Set(headerContentType, mimeJSON)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	client := &http.Client{Timeout: 5 * time.Second}
	var got map[string]any
	_ = doFetchJSON(client, srv.URL, http.MethodGet, nil, &got)

	if gotCT != "" {
		t.Fatalf("expected no Content-Type, got %q", gotCT)
	}
}
