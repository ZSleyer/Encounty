// fetch.go provides outgoing HTTP request helpers with automatic retry logic
// for rate limiting and server errors.
package httputil

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

const (
	// fetchTimeout is the HTTP client timeout for outgoing requests.
	fetchTimeout = 15 * time.Second

	// maxRetries is the maximum number of retry attempts for retriable errors.
	maxRetries = 3

	// defaultRetryAfter is the fallback delay when a 429 response lacks a
	// parseable Retry-After header.
	defaultRetryAfter = 5 * time.Second

	// fmtHTTPStatus is the format string for HTTP error messages containing
	// the status code and URL.
	fmtHTTPStatus = "HTTP %d from %s"
)

// FetchJSON performs an HTTP request and decodes the JSON response into v.
// It handles rate limiting (HTTP 429) and server errors (5xx) with automatic
// retries and exponential backoff. When body is non-nil it is buffered so
// that retries can replay the same payload.
func FetchJSON(url, method string, body io.Reader, v any) error {
	client := &http.Client{Timeout: fetchTimeout}

	// Buffer the body so it can be replayed on retries.
	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = io.ReadAll(body)
		if err != nil {
			return fmt.Errorf("read request body for %s: %w", url, err)
		}
	}

	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		var bodyReader io.Reader
		if bodyBytes != nil {
			bodyReader = bytes.NewReader(bodyBytes)
		}
		lastErr = doFetchJSON(client, url, method, bodyReader, v)
		if lastErr == nil {
			return nil
		}

		re, ok := lastErr.(*retryableError)
		if !ok {
			return lastErr
		}

		if attempt == maxRetries {
			break
		}

		// For 5xx errors the delay is computed here as exponential backoff
		// (1s, 2s, 4s). For 429 the delay comes from the Retry-After header.
		delay := re.delay
		if delay == 0 {
			delay = time.Second * (1 << (attempt - 1))
		}
		re.logAttrs = append(re.logAttrs, "attempt", attempt)
		slog.Warn(re.logMsg, re.logAttrs...)
		time.Sleep(delay)
	}
	return lastErr
}

// GetJSON performs an HTTP GET request and decodes the JSON response.
func GetJSON(url string, v any) error {
	return FetchJSON(url, http.MethodGet, nil, v)
}

// PostJSON performs an HTTP POST request with a JSON body and decodes the
// response.
func PostJSON(url string, body io.Reader, v any) error {
	return FetchJSON(url, http.MethodPost, body, v)
}

// retryableError wraps an error that should be retried, carrying the delay
// and logging attributes for the retry warning.
type retryableError struct {
	err      error
	delay    time.Duration
	logMsg   string
	logAttrs []any
}

// Error implements the error interface.
func (e *retryableError) Error() string { return e.err.Error() }

// Unwrap returns the underlying error.
func (e *retryableError) Unwrap() error { return e.err }

// doFetchJSON executes a single HTTP request and returns a retryableError for
// 429 and 5xx responses so the caller can decide whether to retry.
func doFetchJSON(client *http.Client, url, method string, body io.Reader, v any) error {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return fmt.Errorf("create request for %s: %w", url, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	// 2xx — success path.
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("read response from %s: %w", url, err)
		}
		return json.Unmarshal(respBody, v)
	}

	// 429 — rate limited.
	if resp.StatusCode == http.StatusTooManyRequests {
		delay := parseRetryAfter(resp.Header.Get("Retry-After"))
		return &retryableError{
			err:    fmt.Errorf(fmtHTTPStatus, resp.StatusCode, url),
			delay:  delay,
			logMsg: "Rate limited, retrying",
			logAttrs: []any{
				"url", url,
				"retry_after", delay,
			},
		}
	}

	// 5xx — server error with exponential backoff.
	if resp.StatusCode >= 500 && resp.StatusCode < 600 {
		return &retryableError{
			err:    fmt.Errorf(fmtHTTPStatus, resp.StatusCode, url),
			delay:  0, // filled by caller based on attempt
			logMsg: "Server error, retrying",
			logAttrs: []any{
				"url", url,
				"status", resp.StatusCode,
			},
		}
	}

	// Other 4xx — non-retriable.
	return fmt.Errorf(fmtHTTPStatus, resp.StatusCode, url)
}

// parseRetryAfter parses the Retry-After header value as a number of seconds.
// It returns defaultRetryAfter if the header is empty or unparseable.
func parseRetryAfter(header string) time.Duration {
	if header == "" {
		return defaultRetryAfter
	}
	secs, err := strconv.Atoi(header)
	if err != nil || secs <= 0 {
		return defaultRetryAfter
	}
	return time.Duration(secs) * time.Second
}
