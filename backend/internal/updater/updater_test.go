package updater

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const (
	testCurrentVersion = "v0.8.0"
	testContentType    = "Content-Type"
	testAppJSON        = "application/json"
	fmtUnexpectedErr   = "unexpected error: %v"
)

// withMockAPI starts an httptest.Server, overrides apiBaseURL for the
// duration of the test, and returns the server.
func withMockAPI(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	orig := apiBaseURL
	apiBaseURL = srv.URL
	t.Cleanup(func() { apiBaseURL = orig })
	return srv
}

func TestCheckForUpdateNewerVersionAvailable(t *testing.T) {
	withMockAPI(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(testContentType, testAppJSON)
		_, _ = w.Write([]byte(`{"tag_name":"v0.9.0"}`))
	})

	info, err := CheckForUpdate(testCurrentVersion)
	if err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if !info.Available {
		t.Error("expected available = true")
	}
	if info.LatestVersion != "v0.9.0" {
		t.Errorf("latest_version = %q, want v0.9.0", info.LatestVersion)
	}
	if info.CurrentVersion != testCurrentVersion {
		t.Errorf("current_version = %q, want %s", info.CurrentVersion, testCurrentVersion)
	}
}

func TestCheckForUpdateAlreadyUpToDate(t *testing.T) {
	withMockAPI(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(testContentType, testAppJSON)
		_, _ = w.Write([]byte(`{"tag_name":"v0.8.0"}`))
	})

	info, err := CheckForUpdate(testCurrentVersion)
	if err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if info.Available {
		t.Error("expected available = false when versions match")
	}
}

func TestCheckForUpdateEmptyTag(t *testing.T) {
	withMockAPI(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(testContentType, testAppJSON)
		_, _ = w.Write([]byte(`{"tag_name":""}`))
	})

	info, err := CheckForUpdate(testCurrentVersion)
	if err != nil {
		t.Fatalf(fmtUnexpectedErr, err)
	}
	if info.Available {
		t.Error("expected available = false for empty tag")
	}
}

func TestCheckForUpdateAPIError(t *testing.T) {
	withMockAPI(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	})

	_, err := CheckForUpdate(testCurrentVersion)
	if err == nil {
		t.Fatal("expected error for non-200 response")
	}
}

func TestCheckForUpdateInvalidJSON(t *testing.T) {
	withMockAPI(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(testContentType, testAppJSON)
		_, _ = w.Write([]byte(`not json`))
	})

	_, err := CheckForUpdate(testCurrentVersion)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestCheckForUpdateSetsHeaders(t *testing.T) {
	var gotAccept, gotAPIVersion string
	withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		gotAccept = r.Header.Get("Accept")
		gotAPIVersion = r.Header.Get("X-GitHub-Api-Version")
		w.Header().Set(testContentType, testAppJSON)
		_, _ = w.Write([]byte(`{"tag_name":"v1.0.0"}`))
	})

	_, _ = CheckForUpdate(testCurrentVersion)

	if gotAccept != "application/vnd.github+json" {
		t.Errorf("Accept = %q, want application/vnd.github+json", gotAccept)
	}
	if gotAPIVersion != "2022-11-28" {
		t.Errorf("X-GitHub-Api-Version = %q, want 2022-11-28", gotAPIVersion)
	}
}
