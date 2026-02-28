package state

import (
	"sync"
	"time"
)

type Pokemon struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`           // Display name (localized)
	CanonicalName string    `json:"canonical_name"` // English PokéAPI slug
	SpriteURL     string    `json:"sprite_url"`
	SpriteType    string    `json:"sprite_type"` // "normal" | "shiny"
	Encounters    int       `json:"encounters"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	Language      string    `json:"language"` // "de" | "en"
	Game          string    `json:"game"`     // key from games.json
}

type Session struct {
	ID         string     `json:"id"`
	StartedAt  time.Time  `json:"started_at"`
	EndedAt    *time.Time `json:"ended_at"`
	PokemonID  string     `json:"pokemon_id"`
	Encounters int        `json:"encounters"`
}

type HotkeyMap struct {
	Increment   string `json:"increment"`
	Decrement   string `json:"decrement"`
	Reset       string `json:"reset"`
	NextPokemon string `json:"next_pokemon"`
}

type OverlaySettings struct {
	Layout         string `json:"layout"`          // "horizontal", "vertical", "classic"
	SpritePosition string `json:"sprite_position"` // "top", "bottom", "left", "right", "hidden"
	FontSize       int    `json:"font_size"`
	SpriteSize     int    `json:"sprite_size"`
	FontFamily     string `json:"font_family"`
	TextColor      string `json:"text_color"`
	OutlineColor   string `json:"outline_color"`
	OutlineWidth   int    `json:"outline_width"`
	ShowName       bool   `json:"show_name"`
	// ShowPhase removed
	ShowEncounter      bool    `json:"show_encounter"`
	ShowBorder         bool    `json:"show_border"`
	Gap                int     `json:"gap"`
	CustomFont         string  `json:"custom_font"`
	GradientEnabled    bool    `json:"gradient_enabled"`
	GradientColor      string  `json:"gradient_color"`
	BackgroundColor    string  `json:"background_color"`
	Opacity            float64 `json:"opacity"`
	Blur               int     `json:"blur"`
	AnimationIncrement string  `json:"animation_increment"`
	AnimationDecrement string  `json:"animation_decrement"`
	AnimationReset     string  `json:"animation_reset"`
	ShowSpriteGlow     bool    `json:"show_sprite_glow"`
	SpriteOnTop        bool    `json:"sprite_on_top"`
	AnimationTarget    string  `json:"animation_target"` // "both", "sprite", "counter"
	// Grouping
	InnerLayout  string   `json:"inner_layout"`  // "horizontal", "vertical"
	OuterElement string   `json:"outer_element"` // "sprite", "name", "counter", "none"
	LayerOrder   []string `json:"layer_order"`   // ["sprite", "name", "counter"]
	// Name styling
	NameSize            int    `json:"name_size"`
	NameColor           string `json:"name_color"`
	NameOutlineColor    string `json:"name_outline_color"`
	NameOutlineWidth    int    `json:"name_outline_width"`
	NameGradientEnabled bool   `json:"name_gradient_enabled"`
	NameGradientColor   string `json:"name_gradient_color"`
	NameFontFamily      string `json:"name_font_family"`
	NameCustomFont      string `json:"name_custom_font"`
}

type Settings struct {
	OutputDir   string          `json:"output_dir"`
	AutoSave    bool            `json:"auto_save"`
	BrowserPort int             `json:"browser_port"`
	Overlay     OverlaySettings `json:"overlay"`
}

type AppState struct {
	Pokemon  []Pokemon `json:"pokemon"`
	Sessions []Session `json:"sessions"`
	ActiveID string    `json:"active_id"`
	Hotkeys  HotkeyMap `json:"hotkeys"`
	Settings Settings  `json:"settings"`
}

type Manager struct {
	mu        sync.RWMutex
	state     AppState
	configDir string
	onChange  []func(AppState)
}

func NewManager(configDir string) *Manager {
	m := &Manager{
		configDir: configDir,
		state: AppState{
			Pokemon:  []Pokemon{},
			Sessions: []Session{},
			Settings: Settings{
				AutoSave:    true,
				BrowserPort: 8080,
				Overlay: OverlaySettings{
					Layout:         "horizontal",
					SpritePosition: "left",
					FontSize:       48,
					SpriteSize:     120,
					TextColor:      "#ffffff",
					OutlineColor:   "#000000",
					OutlineWidth:   2,
					ShowName:       true,
					// ShowPhase removed
					ShowEncounter:       true,
					ShowBorder:          true,
					Gap:                 24,
					CustomFont:          "",
					GradientEnabled:     false,
					GradientColor:       "#3b82f6",
					BackgroundColor:     "#000000",
					Opacity:             0.6,
					Blur:                8,
					AnimationIncrement:  "pop",
					AnimationDecrement:  "shake",
					AnimationReset:      "rotate",
					ShowSpriteGlow:      true,
					SpriteOnTop:         false,
					AnimationTarget:     "both",
					InnerLayout:         "vertical",
					OuterElement:        "none",
					LayerOrder:          []string{"sprite", "name", "counter"},
					NameSize:            20,
					NameColor:           "#94a3b8",
					NameOutlineColor:    "#000000",
					NameOutlineWidth:    0,
					NameGradientEnabled: false,
					NameGradientColor:   "#ffffff",
					NameFontFamily:      "sans",
					NameCustomFont:      "",
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

func (m *Manager) OnChange(fn func(AppState)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onChange = append(m.onChange, fn)
}

func (m *Manager) notify() {
	state := m.state
	for _, fn := range m.onChange {
		go fn(state)
	}
}

func (m *Manager) GetState() AppState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

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
			if update.Language != "" {
				m.state.Pokemon[i].Language = update.Language
			}
			if update.Game != "" {
				m.state.Pokemon[i].Game = update.Game
			}

			go m.notify()
			return true
		}
	}
	return false
}

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

func (m *Manager) UpdateSettings(s Settings) {
	m.mu.Lock()
	m.state.Settings = s
	m.mu.Unlock()
	m.notify()
}

func (m *Manager) UpdateHotkeys(h HotkeyMap) {
	m.mu.Lock()
	m.state.Hotkeys = h
	m.mu.Unlock()
	m.notify()
}

func (m *Manager) AddSession(sess Session) {
	m.mu.Lock()
	m.state.Sessions = append(m.state.Sessions, sess)
	m.mu.Unlock()
}

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

func (m *Manager) GetConfigDir() string {
	return m.configDir
}
