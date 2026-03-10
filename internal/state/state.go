// Package state defines all application data types and the in-memory state
// manager. The Manager is the single source of truth for mutable runtime
// state and coordinates safe concurrent access via a read/write mutex.
// Persistence is handled in persist.go; type definitions live here.
package state

import (
	"path/filepath"
	"sync"
	"time"
)

// Pokemon represents a single shiny-hunt session for one Pokémon species.
// It stores display metadata (name, sprite), the running encounter count,
// and an optional per-Pokémon overlay configuration.
type Pokemon struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`           // Display name (localized)
	CanonicalName string           `json:"canonical_name"` // English PokéAPI slug
	SpriteURL     string           `json:"sprite_url"`
	SpriteType    string           `json:"sprite_type"`            // "normal" | "shiny"
	SpriteStyle   string           `json:"sprite_style,omitempty"` // "classic" | "animated" | "3d" | "artwork"
	Encounters    int              `json:"encounters"`
	IsActive      bool             `json:"is_active"`
	CreatedAt     time.Time        `json:"created_at"`
	Language      string           `json:"language"` // "de" | "en"
	Game          string           `json:"game"`     // key from games.json
	CompletedAt   *time.Time       `json:"completed_at,omitempty"`
	Overlay       *OverlaySettings `json:"overlay,omitempty"` // Pokemon-specific overlay settings
	HuntType       string          `json:"hunt_type,omitempty"`
	DetectorConfig *DetectorConfig `json:"detector_config,omitempty"`
}

// Session records one time-boxed encounter run for a single Pokémon.
// Sessions are append-only; an open session has EndedAt == nil.
type Session struct {
	ID         string     `json:"id"`
	StartedAt  time.Time  `json:"started_at"`
	EndedAt    *time.Time `json:"ended_at"`
	PokemonID  string     `json:"pokemon_id"`
	Encounters int        `json:"encounters"`
}

// HotkeyMap holds the key-combo string for each counter action.
// Each value is a human-readable combo such as "F1" or "Ctrl+Shift+A".
type HotkeyMap struct {
	Increment   string `json:"increment"`
	Decrement   string `json:"decrement"`
	Reset       string `json:"reset"`
	NextPokemon string `json:"next_pokemon"`
}

// MatchedRegion defines a bounding box within a template and its match criteria.
type MatchedRegion struct {
	Type         string       `json:"type"`          // "image" | "text"
	ExpectedText string       `json:"expected_text"` // used if Type == "text"
	Rect         DetectorRect `json:"rect"`
}

// DetectorTemplate bundles the saved screenshot and its defined regions.
type DetectorTemplate struct {
	ImagePath string          `json:"image_path"`
	Regions   []MatchedRegion `json:"regions"`
}

// DetectorRect defines a rectangular screen region in absolute pixel coordinates.
type DetectorRect struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// DetectorConfig holds all auto-detection settings for a single Pokémon hunt.
// A nil DetectorConfig means auto-detection is disabled for that hunt.
type DetectorConfig struct {
	Enabled         bool               `json:"enabled"`
	SourceType      string             `json:"source_type"`            // "screen_region" | "window" | "browser_camera" | "browser_display"
	Region          DetectorRect       `json:"region"`
	WindowTitle     string             `json:"window_title"`
	Templates       []DetectorTemplate `json:"templates"`              // replaces TemplatePaths

	Precision       float64            `json:"precision"`              // 0.0–1.0, default 0.85
	ConsecutiveHits int                `json:"consecutive_hits"`       // consecutive matching frames required before counting
	CooldownSec     int                `json:"cooldown_sec"`           // minimum seconds between counts
	ChangeThreshold float64            `json:"change_threshold"`       // pixel-delta fraction required to leave MATCH state
	PollIntervalMs  int                `json:"poll_interval_ms"`       // milliseconds between capture polls
	DetectionLog    []DetectionLogEntry `json:"detection_log,omitempty"` // last maxDetectionLog confirmed matches
}

// DetectionLogEntry records a single confirmed auto-detection match.
type DetectionLogEntry struct {
	// At is the UTC timestamp when the match was confirmed.
	At time.Time `json:"at"`
	// Confidence is the NCC score that triggered the match (0.0–1.0).
	Confidence float64 `json:"confidence"`
}

// maxDetectionLog is the maximum number of log entries retained per hunt.
const maxDetectionLog = 20


// GradientStop defines one colour stop in a CSS-style linear gradient.
type GradientStop struct {
	Color    string  `json:"color"`
	Position float64 `json:"position"`
}

// TextStyle describes the typography and decoration for one text element
// in the OBS overlay (name label or encounter counter).
type TextStyle struct {
	FontFamily      string         `json:"font_family"`
	FontSize        int            `json:"font_size"`
	FontWeight      int            `json:"font_weight"`
	ColorType       string         `json:"color_type"` // "solid" | "gradient"
	Color           string         `json:"color"`
	GradientStops   []GradientStop `json:"gradient_stops"`
	GradientAngle   int            `json:"gradient_angle"`
	OutlineType     string         `json:"outline_type"` // "none" | "solid"
	OutlineWidth    int            `json:"outline_width"`
	OutlineColor    string         `json:"outline_color"`
	TextShadow      bool           `json:"text_shadow"`
	TextShadowColor string         `json:"text_shadow_color"`
	TextShadowBlur  int            `json:"text_shadow_blur"`
	TextShadowX     int            `json:"text_shadow_x"`
	TextShadowY     int            `json:"text_shadow_y"`
}

// OverlayElementBase holds position and size fields shared by every overlay
// element. Coordinates are in canvas pixels (origin: top-left).
type OverlayElementBase struct {
	Visible bool `json:"visible"`
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Width   int  `json:"width"`
	Height  int  `json:"height"`
	ZIndex  int  `json:"z_index"`
}

// SpriteElement configures the Pokémon sprite layer of the overlay,
// including optional glow effect and entry/idle animations.
type SpriteElement struct {
	OverlayElementBase
	ShowGlow      bool    `json:"show_glow"`
	GlowColor     string  `json:"glow_color"`
	GlowOpacity   float64 `json:"glow_opacity"`
	GlowBlur      int     `json:"glow_blur"`
	IdleAnimation string  `json:"idle_animation"`
	TriggerEnter  string  `json:"trigger_enter"`
	TriggerExit   string  `json:"trigger_exit"`
}

// NameElement configures the Pokémon name text layer of the overlay.
type NameElement struct {
	OverlayElementBase
	Style         TextStyle `json:"style"`
	IdleAnimation string    `json:"idle_animation"`
	TriggerEnter  string    `json:"trigger_enter"`
}

// CounterElement configures the encounter-count text layer of the overlay,
// including an optional descriptive label rendered above or below the number.
type CounterElement struct {
	OverlayElementBase
	Style         TextStyle `json:"style"`
	ShowLabel     bool      `json:"show_label"`
	LabelText     string    `json:"label_text"`
	LabelStyle    TextStyle `json:"label_style"`
	IdleAnimation string    `json:"idle_animation"`
	TriggerEnter  string    `json:"trigger_enter"`
}

// OverlaySettings is the complete configuration for the OBS Browser Source
// overlay. It uses an absolute-positioning canvas model: each element has its
// own x/y/width/height within a fixed canvas.
type OverlaySettings struct {
	CanvasWidth       int            `json:"canvas_width"`
	CanvasHeight      int            `json:"canvas_height"`
	Hidden            bool           `json:"hidden"`
	BackgroundColor   string         `json:"background_color"`
	BackgroundOpacity float64        `json:"background_opacity"`
	BackgroundAnimation string      `json:"background_animation"`
	Blur              int            `json:"blur"`
	ShowBorder        bool           `json:"show_border"`
	BorderColor       string         `json:"border_color"`
	BorderWidth       int            `json:"border_width"`
	BorderRadius      int            `json:"border_radius"`
	Sprite            SpriteElement  `json:"sprite"`
	Name              NameElement    `json:"name"`
	Counter           CounterElement `json:"counter"`
}

// Settings holds user-configurable application preferences that are persisted
// alongside the Pokémon list in state.json.
type Settings struct {
	OutputEnabled bool            `json:"output_enabled"`
	OutputDir     string          `json:"output_dir"`
	AutoSave      bool            `json:"auto_save"`
	BrowserPort  int             `json:"browser_port"`
	Languages    []string        `json:"languages"` // active game-name languages; default ["de","en"]
	CrispSprites bool            `json:"crisp_sprites"`
	Overlay      OverlaySettings `json:"overlay"`
}

// AppState is the complete serialisable snapshot of the application. It is
// sent to the frontend on every WebSocket connection and after every mutation.
type AppState struct {
	Pokemon  []Pokemon `json:"pokemon"`
	Sessions []Session `json:"sessions"`
	ActiveID string    `json:"active_id"`
	Hotkeys  HotkeyMap `json:"hotkeys"`
	Settings Settings  `json:"settings"`
	DataPath string    `json:"data_path"`
}

// Manager holds all in-memory application state and coordinates safe
// concurrent access. All mutations go through Manager methods, which
// hold the appropriate lock and then dispatch onChange callbacks so
// that the WebSocket hub can broadcast the updated state.
type Manager struct {
	mu        sync.RWMutex
	state     AppState
	configDir string
	onChange  []func(AppState)
}

// NewManager creates a Manager with sensible defaults for all settings.
// The defaults are used as-is until Load() overwrites them from disk.
func NewManager(configDir string) *Manager {
	m := &Manager{
		configDir: configDir,
		state: AppState{
			DataPath: configDir,
			Pokemon:  []Pokemon{},
			Sessions: []Session{},
			Settings: Settings{
				OutputEnabled: false,
				OutputDir:     filepath.Join(configDir, "output"),
				AutoSave:      true,
				BrowserPort:   8080,
				Languages:   []string{"de", "en"},
				Overlay: OverlaySettings{
					CanvasWidth:       800,
					CanvasHeight:      200,
					BackgroundColor:   "#000000",
					BackgroundOpacity: 0.6,
					BackgroundAnimation: "none",
					Blur:              8,
					ShowBorder:        true,
					BorderColor:       "rgba(255,255,255,0.1)",
					BorderRadius:      40,
					Sprite: SpriteElement{
						OverlayElementBase: OverlayElementBase{Visible: true, X: 10, Y: 10, Width: 180, Height: 180, ZIndex: 1},
						ShowGlow:           true,
						GlowColor:          "#ffffff",
						GlowOpacity:        0.2,
						GlowBlur:           20,
						IdleAnimation:      "float",
						TriggerEnter:       "pop",
					},
					Name: NameElement{
						OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 20, Width: 300, Height: 40, ZIndex: 2},
						Style: TextStyle{
							FontFamily:   "sans",
							FontSize:     20,
							FontWeight:   400,
							ColorType:    "solid",
							Color:        "#94a3b8",
							OutlineType:  "none",
							OutlineColor: "#000000",
						},
						IdleAnimation: "none",
						TriggerEnter:  "fade-in",
					},
					Counter: CounterElement{
						OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 80, Width: 300, Height: 100, ZIndex: 3},
						Style: TextStyle{
							FontFamily:   "pokemon",
							FontSize:     80,
							FontWeight:   700,
							ColorType:    "solid",
							Color:        "#ffffff",
							OutlineType:  "solid",
							OutlineWidth: 6,
							OutlineColor: "#000000",
						},
						ShowLabel: false,
						LabelText: "Begegnungen",
						LabelStyle: TextStyle{
							FontFamily: "sans",
							FontSize:   14,
							FontWeight: 400,
							ColorType:  "solid",
							Color:      "#94a3b8",
						},
						IdleAnimation: "none",
						TriggerEnter:  "pop",
					},
				},
			},
			Hotkeys: HotkeyMap{
				Increment:   "F1",
				Decrement:   "F2",
				Reset:       "F3",
				NextPokemon: "F4",
			},
		},
	}
	return m
}

// OnChange registers a callback that is invoked (in its own goroutine) after
// every state mutation. The callback receives a value copy of the state so it
// is safe to read without holding the lock.
func (m *Manager) OnChange(fn func(AppState)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onChange = append(m.onChange, fn)
}

// notify dispatches all registered onChange callbacks with a copy of the
// current state. Each callback runs in its own goroutine so that slow
// subscribers (e.g. WebSocket broadcast) cannot block the caller.
// Must be called without holding mu (callbacks take their own locks).
func (m *Manager) notify() {
	state := m.state
	for _, fn := range m.onChange {
		go fn(state)
	}
}

// GetState returns a value copy of the current application state.
// Safe to call concurrently; acquires a read lock.
func (m *Manager) GetState() AppState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

// GetActivePokemon returns a pointer to a copy of the currently active
// Pokémon, or nil if no Pokémon is active. The returned value is safe to
// read after the lock is released because it is a copy.
func (m *Manager) GetActivePokemon() *Pokemon {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == m.state.ActiveID {
			p := m.state.Pokemon[i]
			return &p
		}
	}
	return nil
}

// AddPokemon appends p to the Pokémon list. If the list was empty before,
// p is automatically set as the active Pokémon.
func (m *Manager) AddPokemon(p Pokemon) {
	m.mu.Lock()
	m.state.Pokemon = append(m.state.Pokemon, p)
	if m.state.ActiveID == "" {
		m.state.ActiveID = p.ID
		for i := range m.state.Pokemon {
			m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == p.ID
		}
	}
	m.mu.Unlock()
	m.notify()
}

// UpdatePokemon applies non-zero fields from update to the Pokémon with the
// given id. Returns false if no matching Pokémon was found.
// Only user-editable fields are updated; immutable fields like ID and
// CreatedAt are always preserved.
func (m *Manager) UpdatePokemon(id string, update Pokemon) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			// Update only user-editable fields
			if update.Name != "" {
				m.state.Pokemon[i].Name = update.Name
			}
			if update.CanonicalName != "" {
				m.state.Pokemon[i].CanonicalName = update.CanonicalName
			}
			if update.SpriteURL != "" {
				m.state.Pokemon[i].SpriteURL = update.SpriteURL
			}
			if update.SpriteType != "" {
				m.state.Pokemon[i].SpriteType = update.SpriteType
			}
			// Always update SpriteStyle (allow clearing to "" which means "classic")
			m.state.Pokemon[i].SpriteStyle = update.SpriteStyle
			if update.Language != "" {
				m.state.Pokemon[i].Language = update.Language
			}
			if update.Game != "" {
				m.state.Pokemon[i].Game = update.Game
			}

			// Empty string check won't work for struct pointers. We either allow clearing via special means
			// or replace if provided. But since we send the whole Pokemon back, we just replace it:
			m.state.Pokemon[i].Overlay = update.Overlay

			go m.notify()
			return true
		}
	}
	return false
}

// DeletePokemon removes the Pokémon with the given id. If it was the active
// Pokémon, the first remaining entry becomes active. Returns false if not found.
func (m *Manager) DeletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.state.Pokemon {
		if p.ID == id {
			m.state.Pokemon = append(m.state.Pokemon[:i], m.state.Pokemon[i+1:]...)
			if m.state.ActiveID == id {
				m.state.ActiveID = ""
				if len(m.state.Pokemon) > 0 {
					m.state.ActiveID = m.state.Pokemon[0].ID
					m.state.Pokemon[0].IsActive = true
				}
			}
			go m.notify()
			return true
		}
	}
	return false
}

// Increment adds one encounter to the Pokémon with the given id.
// Returns the new count and true, or (0, false) if not found.
func (m *Manager) Increment(id string) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].Encounters++
			count := m.state.Pokemon[i].Encounters
			go m.notify()
			return count, true
		}
	}
	return 0, false
}

// Decrement subtracts one encounter from the Pokémon with the given id,
// flooring at zero to prevent negative counts.
// Returns the new count and true, or (0, false) if not found.
func (m *Manager) Decrement(id string) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			if m.state.Pokemon[i].Encounters > 0 {
				m.state.Pokemon[i].Encounters--
			}
			count := m.state.Pokemon[i].Encounters
			go m.notify()
			return count, true
		}
	}
	return 0, false
}

// Reset sets the encounter counter for the given Pokémon to zero.
// Returns false if the Pokémon was not found.
func (m *Manager) Reset(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].Encounters = 0
			go m.notify()
			return true
		}
	}
	return false
}

// SetActive marks the Pokémon with the given id as active and clears the
// IsActive flag on all others. Returns false if no matching Pokémon exists.
func (m *Manager) SetActive(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for _, p := range m.state.Pokemon {
		if p.ID == id {
			found = true
			break
		}
	}
	if !found {
		return false
	}
	m.state.ActiveID = id
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == id
	}
	go m.notify()
	return true
}

// CompletePokemon stamps the Pokémon's CompletedAt field with the current
// time, marking the hunt as finished. Returns false if not found.
func (m *Manager) CompletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			now := time.Now()
			m.state.Pokemon[i].CompletedAt = &now
			go m.notify()
			return true
		}
	}
	return false
}

// UncompletePokemon clears the CompletedAt timestamp, moving the Pokémon
// back to active-hunt status. Returns false if not found.
func (m *Manager) UncompletePokemon(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].CompletedAt = nil
			go m.notify()
			return true
		}
	}
	return false
}

// NextPokemon advances the active Pokémon to the next entry in the list,
// wrapping around at the end. No-ops when the list is empty.
func (m *Manager) NextPokemon() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.state.Pokemon) == 0 {
		return
	}
	idx := 0
	for i, p := range m.state.Pokemon {
		if p.ID == m.state.ActiveID {
			idx = (i + 1) % len(m.state.Pokemon)
			break
		}
	}
	m.state.ActiveID = m.state.Pokemon[idx].ID
	for i := range m.state.Pokemon {
		m.state.Pokemon[i].IsActive = m.state.Pokemon[i].ID == m.state.ActiveID
	}
	go m.notify()
}

// UpdateSettings replaces the application settings atomically and notifies
// all listeners so the frontend and file-output writer stay in sync.
func (m *Manager) UpdateSettings(s Settings) {
	m.mu.Lock()
	m.state.Settings = s
	m.mu.Unlock()
	m.notify()
}

// UpdateHotkeys replaces the full hotkey map and notifies listeners.
func (m *Manager) UpdateHotkeys(h HotkeyMap) {
	m.mu.Lock()
	m.state.Hotkeys = h
	m.mu.Unlock()
	m.notify()
}

// UpdateSingleHotkey updates one field of the HotkeyMap and notifies listeners.
// Returns false if action is not a recognised key name.
func (m *Manager) UpdateSingleHotkey(action, key string) bool {
	m.mu.Lock()
	switch action {
	case "increment":
		m.state.Hotkeys.Increment = key
	case "decrement":
		m.state.Hotkeys.Decrement = key
	case "reset":
		m.state.Hotkeys.Reset = key
	case "next_pokemon":
		m.state.Hotkeys.NextPokemon = key
	default:
		m.mu.Unlock()
		return false
	}
	m.mu.Unlock()
	m.notify()
	return true
}

// AddSession appends a new session record. Sessions are informational only
// and are not currently used to drive encounter counts.
func (m *Manager) AddSession(sess Session) {
	m.mu.Lock()
	m.state.Sessions = append(m.state.Sessions, sess)
	m.mu.Unlock()
}

// EndSession sets the EndedAt timestamp on the open session with the given id.
func (m *Manager) EndSession(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for i := range m.state.Sessions {
		if m.state.Sessions[i].ID == id && m.state.Sessions[i].EndedAt == nil {
			m.state.Sessions[i].EndedAt = &now
			break
		}
	}
}

// SetDetectorConfig replaces the DetectorConfig for the Pokémon with the given id.
// Pass nil to disable auto-detection for that hunt.
// Returns false if no matching Pokémon was found.
func (m *Manager) SetDetectorConfig(id string, cfg *DetectorConfig) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == id {
			m.state.Pokemon[i].DetectorConfig = cfg
			go m.notify()
			return true
		}
	}
	return false
}

// GetConfigDir returns the directory used for state persistence
// (e.g. ~/.config/encounty on Linux).
func (m *Manager) GetConfigDir() string {
	return m.configDir
}

// AppendDetectionLog records a confirmed auto-detection match for the Pokémon
// with the given id. Only the last maxDetectionLog entries are retained; older
// entries are dropped (FIFO). No-ops silently if the Pokémon has no DetectorConfig.
func (m *Manager) AppendDetectionLog(id string, confidence float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		p := &m.state.Pokemon[i]
		if p.ID != id || p.DetectorConfig == nil {
			continue
		}
		entry := DetectionLogEntry{At: time.Now().UTC(), Confidence: confidence}
		p.DetectorConfig.DetectionLog = append(p.DetectorConfig.DetectionLog, entry)
		if len(p.DetectorConfig.DetectionLog) > maxDetectionLog {
			p.DetectorConfig.DetectionLog = p.DetectorConfig.DetectionLog[len(p.DetectorConfig.DetectionLog)-maxDetectionLog:]
		}
		return
	}
}
