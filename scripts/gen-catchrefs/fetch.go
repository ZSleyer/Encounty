// fetch.go holds the HTTP helpers shared by the source fetchers.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// httpAttempts is how often a failing request is retried before giving up.
const httpAttempts = 3

// httpClient is the shared client for all outgoing requests.
var httpClient = &http.Client{Timeout: 60 * time.Second}

// fetch performs an HTTP request and returns the response body, retrying a
// few times on transport errors and non-200 responses.
func fetch(method, url, body string) ([]byte, error) {
	var lastErr error
	for attempt := 1; attempt <= httpAttempts; attempt++ {
		if attempt > 1 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
		var reader io.Reader
		if body != "" {
			reader = strings.NewReader(body)
		}
		req, err := http.NewRequest(method, url, reader)
		if err != nil {
			return nil, err
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		data, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
			continue
		}
		return data, nil
	}
	return nil, lastErr
}

// getText downloads a plain text file and strips a leading byte order mark.
func getText(url string) (string, error) {
	data, err := fetch(http.MethodGet, url, "")
	if err != nil {
		return "", err
	}
	return strings.TrimPrefix(string(data), "\ufeff"), nil
}

// getJSON downloads a JSON document and decodes it into v.
func getJSON(url string, v any) error {
	data, err := fetch(http.MethodGet, url, "")
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

// pokeAPIGraphQL is the PokeAPI GraphQL v1beta2 endpoint, the same one the
// Pokedex sync uses.
const pokeAPIGraphQL = "https://graphql.pokeapi.co/v1beta2"

// graphQL posts a GraphQL query to PokeAPI and decodes the data envelope
// into v.
func graphQL(query string, v any) error {
	data, err := fetch(http.MethodPost, pokeAPIGraphQL, `{"query":`+strconv.Quote(query)+`}`)
	if err != nil {
		return err
	}
	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	if len(envelope.Errors) > 0 {
		return fmt.Errorf("GraphQL error: %s", envelope.Errors[0].Message)
	}
	return json.Unmarshal(envelope.Data, v)
}

// langName is a localized name row as PokeAPI returns it.
type langName struct {
	Name     string `json:"name"`
	Language struct {
		Name string `json:"name"`
	} `json:"language"`
}

// namesOf turns PokeAPI language rows into a name map covering all five UI
// locales, falling back to English where a translation is missing.
func namesOf(rows []langName) map[string]string {
	return fillMissing(rawNamesOf(rows))
}

// rawNamesOf turns PokeAPI language rows into a name map that holds only the
// locales PokeAPI actually answered. Callers that top the map up from another
// source need that distinction, an already filled map cannot tell a real
// translation from the English fallback.
func rawNamesOf(rows []langName) map[string]string {
	names := make(map[string]string, len(langs))
	for _, r := range rows {
		if isUILang(r.Language.Name) {
			names[r.Language.Name] = r.Name
		}
	}
	return names
}

// isUILang reports whether code is one of the five shipped UI locales.
func isUILang(code string) bool {
	for _, l := range langs {
		if l == code {
			return true
		}
	}
	return false
}
