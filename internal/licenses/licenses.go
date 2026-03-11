// Package licenses embeds third-party license data collected at build time
// and exposes it via a typed slice for the REST API.
package licenses

import (
	_ "embed"
	"encoding/json"
	"sync"
)

//go:embed third_party.json
var raw []byte

// Entry represents a single third-party dependency with its license info.
type Entry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	License string `json:"license"`
	Text    string `json:"text"`
	Source  string `json:"source"`
}

var (
	entries []Entry
	once    sync.Once
)

// All returns every collected third-party license entry.
func All() []Entry {
	once.Do(func() {
		if err := json.Unmarshal(raw, &entries); err != nil {
			entries = []Entry{}
		}
	})
	return entries
}
