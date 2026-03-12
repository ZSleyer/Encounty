package state

import "testing"

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

func TestAllPresetsHaveNames(t *testing.T) {
	for _, p := range HuntTypePresets {
		if p.NameEN == "" {
			t.Errorf("preset %q has empty NameEN", p.Key)
		}
		if p.NameDE == "" {
			t.Errorf("preset %q has empty NameDE", p.Key)
		}
	}
}
