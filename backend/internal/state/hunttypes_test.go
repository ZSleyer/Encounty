package state

import (
	"encoding/json"
	"testing"
)

func TestPresetsNotEmpty(t *testing.T) {
	if len(HuntTypePresets) == 0 {
		t.Fatal("HuntTypePresets should not be empty")
	}
}

func TestPresetsByKeyCompleteness(t *testing.T) {
	if len(HuntTypePresetsByKey) != len(HuntTypePresets) {
		t.Errorf("PresetsByKey has %d entries, Presets has %d (should match)",
			len(HuntTypePresetsByKey), len(HuntTypePresets))
	}
	for _, p := range HuntTypePresets {
		if _, ok := HuntTypePresetsByKey[p.Key]; !ok {
			t.Errorf("preset %q missing from PresetsByKey", p.Key)
		}
	}
}

func TestAllPresetsHaveValidOdds(t *testing.T) {
	for _, p := range HuntTypePresets {
		t.Run(p.Key, func(t *testing.T) {
			if p.OddsNumer <= 0 {
				t.Errorf("OddsNumer = %d, want > 0", p.OddsNumer)
			}
			if p.OddsDenom <= 0 {
				t.Errorf("OddsDenom = %d, want > 0", p.OddsDenom)
			}
		})
	}
}

func TestAllPresetsHaveUniqueKeys(t *testing.T) {
	seen := make(map[string]bool)
	for _, p := range HuntTypePresets {
		if seen[p.Key] {
			t.Errorf("duplicate key: %q", p.Key)
		}
		seen[p.Key] = true
	}
}

func TestAllPresetsHaveTemplateTips(t *testing.T) {
	for _, p := range HuntTypePresets {
		if p.TemplateTip == "" {
			t.Errorf("preset %q has empty TemplateTip", p.Key)
		}
	}
}

func TestPresetJSONKeys(t *testing.T) {
	data, err := json.Marshal(HuntTypePresets[0])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := map[string]bool{
		"key": true, "odds_numer": true, "odds_denom": true,
		"default_cooldown_sec": true, "default_consecutive_hits": true,
		"template_tip": true,
	}
	for k := range decoded {
		if !want[k] {
			t.Errorf("unexpected JSON key %q, the frontend reads snake_case", k)
		}
		delete(want, k)
	}
	for k := range want {
		t.Errorf("missing JSON key %q", k)
	}
}
