// overlay_defaults.go builds the overlay layout a fresh installation starts
// with: the shared typography, the caption strings per language and the
// assembled default settings object. It is kept apart from the overlay types so
// that changing what the default looks like never touches the data model.

package state

// overlayValueStyle returns the value typography shared by every text layer of
// the default overlay: one sans face at the given size, --text-primary on the
// panel, no stroke, and the minimal shadow floor. The shadow is invisible on
// the plate but keeps the text readable for users who drop the background
// opacity to 0 or hide the canvas layer entirely. The stroke color is the
// panel rather than black, so a user who switches the stroke on gets a halo
// against the plate instead of a cartoon key line.
func overlayValueStyle(size int) TextStyle {
	return TextStyle{
		FontFamily:      fontSans,
		FontSize:        size,
		FontWeight:      700,
		TextAlign:       "left",
		ColorType:       colorTypeSolid,
		Color:           colorTextPrimary,
		OutlineType:     outlineTypeNone,
		OutlineWidth:    2,
		OutlineColor:    colorBgPrimary,
		TextShadow:      true,
		TextShadowColor: colorBlack,
		TextShadowX:     0,
		TextShadowY:     1,
		TextShadowBlur:  3,
	}
}

// overlayLabelStyle returns the caption typography of the label channel, the
// single caption rule of the default layout: every stat captions itself with a
// label, none of them with an inline prefix.
func overlayLabelStyle() TextStyle {
	return TextStyle{
		FontFamily: fontSans,
		FontSize:   11,
		FontWeight: 600,
		TextAlign:  "left",
		ColorType:  colorTypeSolid,
		Color:      colorTextMuted,
	}
}

// overlayLabelSet holds the six captions the default overlay writes into its
// label channels, in one language.
type overlayLabelSet struct {
	Encounters      string
	Time            string
	Odds            string
	Phase           string
	TotalEncounters string
	TotalTime       string
}

// overlayLabels maps a language code to the captions the seeded default overlay
// uses. A caption is stored text, not rendered text: it is written into the
// overlay once, on first run, and belongs to the user afterwards, so it has to
// be in their language from the start.
//
// The values are the `overlay.label*` keys of frontend/src/locales/*.json.
// Keeping a small table here rather than reading those files keeps the backend
// free of the frontend's assets; the frontend test in overlayTemplates.test.ts
// and the table test in state_test.go guard the two copies.
//
// German keeps the English loan words the Pokémon community uses (Encounter,
// Odds), which is why "ENCOUNTER" and "ODDS" are not translated there.
var overlayLabels = map[string]overlayLabelSet{
	"de": {"ENCOUNTER", "ZEIT", "ODDS", "PHASE", "ENCOUNTER GESAMT", "ZEIT GESAMT"},
	"en": {"ENCOUNTERS", "TIME", "ODDS", "PHASE", "TOTAL ENCOUNTERS", "TOTAL TIME"},
	"es": {"ENCUENTROS", "TIEMPO", "PROBABILIDAD", "FASE", "ENCUENTROS TOTALES", "TIEMPO TOTAL"},
	"fr": {"RENCONTRES", "TEMPS", "PROBABILITÉ", "PHASE", "RENCONTRES TOTALES", "TEMPS TOTAL"},
	"ja": {"エンカウント", "タイム", "確率", "フェーズ", "合計エンカウント", "合計タイム"},
}

// overlayLabelsFor picks the caption set for the first configured language.
// Anything the table does not know, including an empty configuration, falls
// back to English.
func overlayLabelsFor(languages []string) overlayLabelSet {
	if len(languages) > 0 {
		if labels, ok := overlayLabels[languages[0]]; ok {
			return labels
		}
	}
	return overlayLabels["en"]
}

// overlayStripStat returns one of the three phasing slots of the default stat
// strip. They differ only in position, z-index and caption, and all three ship
// hidden: a phase number, a total encounter count and a total time say nothing
// until the user actually phases.
func overlayStripStat(x, zIndex int, label string) LabeledTextElement {
	return LabeledTextElement{
		OverlayElementBase: OverlayElementBase{Visible: false, X: x, Y: 196, Width: 144, Height: 44, ZIndex: zIndex},
		Style:              overlayValueStyle(20),
		ShowLabel:          true,
		LabelText:          label,
		LabelStyle:         overlayLabelStyle(),
		PrefixText:         "",
		SuffixText:         "",
		IdleAnimation:      animationNone,
		TriggerEnter:       animationNone,
		TriggerDecrement:   animationNone,
	}
}

// defaultOverlaySettings returns the default overlay layout: an 800x264 panel
// on a 24px margin, read as three bands (sprite plus identity header, hero
// counter, stat strip). The strip runs along the bottom margin as five 144px
// slots with 8px gutters, so the two stats that ship visible bracket it against
// both page margins and the three hidden phasing stats grow inward without
// moving a single coordinate.
//
// It is kept in sync with `buildDefaultOverlaySettings` in
// frontend/src/components/overlay-editor/overlayTemplates.ts so the initial
// overlay (created in NewManager) is identical to the layout the "reset
// overlay" button produces. The migrations in persist.go fill absent elements
// from here as well, so the three copies cannot drift apart.
//
// The captions come from the configured languages because the backend has no
// translator: the first entry decides, English fills in for anything the label
// table does not cover.
func defaultOverlaySettings(languages []string) OverlaySettings {
	labels := overlayLabelsFor(languages)
	return OverlaySettings{
		CanvasWidth:     800,
		CanvasHeight:    264,
		BackgroundColor: colorBgPrimary,
		// 0.9 rather than the old 0.6: every text color has to clear 4.5:1 even
		// over a fully white game capture.
		BackgroundOpacity:   0.9,
		BackgroundAnimation: animationNone,
		Blur:                0,
		ShowBorder:          true,
		BorderColor:         colorBorderSubtle,
		BorderWidth:         1,
		BorderRadius:        0,
		Sprite: SpriteElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 24, Y: 24, Width: 152, Height: 152, ZIndex: 1},
			ShowGlow:           true,
			GlowColor:          colorTextPrimary,
			// A backlight that lifts a dark sprite off the panel, not a soft bloom.
			GlowOpacity:   0.1,
			GlowBlur:      24,
			IdleAnimation: animationNone,
			// Motion on the counting hotkeys is feedback that the key fired, not
			// decoration, so both triggers stay on.
			TriggerEnter:      "bounce",
			TriggerDecrement:  "shake",
			CyclePhaseTargets: false,
			CycleIntervalMs:   defaultSpriteCycleIntervalMs,
			CycleTransition:   defaultSpriteCycleTransition,
		},
		Name: NameElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 24, Width: 576, Height: 34, ZIndex: 2},
			Style:              overlayValueStyle(26),
			IdleAnimation:      animationNone,
			TriggerEnter:       animationNone,
			TriggerDecrement:   animationNone,
		},
		Title: TitleElement{
			// The renderer only paints the title when the hunt has one, so shipping
			// it visible costs an untitled hunt nothing and saves a trip to the
			// layer list for everyone else.
			OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 62, Width: 576, Height: 22, ZIndex: 4},
			Style:              titleStyle(),
			IdleAnimation:      animationNone,
			TriggerEnter:       animationNone,
			TriggerDecrement:   animationNone,
		},
		Counter: CounterElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 200, Y: 92, Width: 576, Height: 88, ZIndex: 3},
			Style:              overlayValueStyle(64),
			ShowLabel:          true,
			LabelText:          labels.Encounters,
			LabelStyle:         overlayLabelStyle(),
			// The caption lives in the label channel, not in the prefix: a prefix
			// renders inline in the value's own style, so at 64px it would
			// overflow the card.
			PrefixText:       "",
			SuffixText:       "",
			IdleAnimation:    animationNone,
			TriggerEnter:     "slot",
			TriggerDecrement: "slot",
		},
		Timer: TimerElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 24, Y: 196, Width: 144, Height: 44, ZIndex: 5},
			Style:              overlayValueStyle(20),
			ShowLabel:          true,
			LabelText:          labels.Time,
			LabelStyle:         overlayLabelStyle(),
			PrefixText:         "",
			SuffixText:         "",
			IdleAnimation:      animationNone,
		},
		Odds: OddsElement{
			OverlayElementBase: OverlayElementBase{Visible: true, X: 632, Y: 196, Width: 144, Height: 44, ZIndex: 6},
			Style:              oddsStyle(),
			ShowLabel:          true,
			LabelText:          labels.Odds,
			LabelStyle:         overlayLabelStyle(),
			PrefixText:         "",
			SuffixText:         "",
			Format:             "fractional",
			IdleAnimation:      animationNone,
			TriggerEnter:       animationNone,
			TriggerDecrement:   animationNone,
		},
		Phase:        overlayStripStat(176, 7, labels.Phase),
		TotalCounter: overlayStripStat(328, 8, labels.TotalEncounters),
		TotalTimer:   overlayStripStat(480, 9, labels.TotalTime),
	}
}

// titleStyle returns the typography of the title layer: one step below the name
// in both size and color, so the header column reads as a hierarchy.
func titleStyle() TextStyle {
	s := overlayValueStyle(13)
	s.FontWeight = 600
	s.Color = colorTextSecondary
	return s
}

// oddsStyle returns the typography of the odds layer. It carries the single
// accent of the layout and is the only right-aligned element, so its value and
// label both hug the right page margin.
func oddsStyle() TextStyle {
	s := overlayValueStyle(20)
	s.Color = colorAccentViolet
	s.TextAlign = "right"
	return s
}
