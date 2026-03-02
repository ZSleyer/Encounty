package state

import (
	"sync"
	"time"
)

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
	Language      string           `json:"language"`          // "de" | "en"
	Game          string           `json:"game"`              // key from games.json
	Overlay       *OverlaySettings `json:"overlay,omitempty"` // Pokemon-specific overlay settings
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

type GradientStop struct {
	Color    string  `json:"color"`
	Position float64 `json:"position"`
}

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

type OverlayElementBase struct {
	Visible bool `json:"visible"`
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Width   int  `json:"width"`
	Height  int  `json:"height"`
	ZIndex  int  `json:"z_index"`
}

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

type NameElement struct {
	OverlayElementBase
	Style         TextStyle `json:"style"`
	IdleAnimation string    `json:"idle_animation"`
	TriggerEnter  string    `json:"trigger_enter"`
}

type CounterElement struct {
	OverlayElementBase
	Style         TextStyle `json:"style"`
	ShowLabel     bool      `json:"show_label"`
	LabelText     string    `json:"label_text"`
	LabelStyle    TextStyle `json:"label_style"`
	IdleAnimation string    `json:"idle_animation"`
	TriggerEnter  string    `json:"trigger_enter"`
}

type OverlaySettings struct {
	CanvasWidth       int            `json:"canvas_width"`
	CanvasHeight      int            `json:"canvas_height"`
	BackgroundColor   string         `json:"background_color"`
	BackgroundOpacity float64        `json:"background_opacity"`
	Blur              int            `json:"blur"`
	ShowBorder        bool           `json:"show_border"`
	BorderColor       string         `json:"border_color"`
	BorderRadius      int            `json:"border_radius"`
	Sprite            SpriteElement  `json:"sprite"`
	Name              NameElement    `json:"name"`
	Counter           CounterElement `json:"counter"`
}

type Settings struct {
	OutputDir   string          `json:"output_dir"`
	AutoSave    bool            `json:"auto_save"`
	BrowserPort int             `json:"browser_port"`
	Languages   []string        `json:"languages"` // active game-name languages; default ["de","en"]
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
				Languages:   []string{"de", "en"},
				Overlay: OverlaySettings{
					CanvasWidth:       800,
					CanvasHeight:      200,
					BackgroundColor:   "#000000",
					BackgroundOpacity: 0.6,
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
