package detector

import (
	"image"
	"image/color"
	"testing"
)

func TestTextMatches(t *testing.T) {
	tests := []struct {
		name       string
		recognized string
		expected   string
		want       bool
	}{
		{
			name:       "exact match",
			recognized: "Pikachu",
			expected:   "pikachu",
			want:       true,
		},
		{
			name:       "case insensitive",
			recognized: "CHARMANDER",
			expected:   "charmander",
			want:       true,
		},
		{
			name:       "recognized contains expected",
			recognized: "A wild Pikachu appeared!",
			expected:   "pikachu",
			want:       true,
		},
		{
			name:       "expected contains recognized",
			recognized: "pika",
			expected:   "pikachu",
			want:       true,
		},
		{
			name:       "small OCR error within tolerance",
			recognized: "Pikacbu",
			expected:   "pikachu",
			want:       true,
		},
		{
			name:       "completely different strings",
			recognized: "Bulbasaur",
			expected:   "Charmander",
			want:       false,
		},
		{
			name:       "empty recognized",
			recognized: "",
			expected:   "pikachu",
			want:       false,
		},
		{
			name:       "empty expected",
			recognized: "pikachu",
			expected:   "",
			want:       false,
		},
		{
			name:       "both empty",
			recognized: "",
			expected:   "",
			want:       false,
		},
		{
			name:       "whitespace trimming",
			recognized: "  pikachu  ",
			expected:   "pikachu",
			want:       true,
		},
		{
			name:       "short string within levenshtein tolerance",
			recognized: "ab",
			expected:   "ac",
			want:       true,
		},
		{
			name:       "one character off on longer string",
			recognized: "Charmandr",
			expected:   "Charmander",
			want:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TextMatches(tt.recognized, tt.expected)
			if got != tt.want {
				t.Errorf("TextMatches(%q, %q) = %v, want %v", tt.recognized, tt.expected, got, tt.want)
			}
		})
	}
}

func TestLangToTesseract(t *testing.T) {
	tests := []struct {
		lang string
		want string
	}{
		{"de", "deu"},
		{"fr", "fra"},
		{"es", "spa"},
		{"it", "ita"},
		{"ja", "jpn"},
		{"ko", "kor"},
		{"zh-hans", "chi_sim"},
		{"zh-hant", "chi_sim"},
		{"en", "eng"},
		{"", "eng"},
		{"unknown", "eng"},
		{"pt", "eng"},
	}

	for _, tt := range tests {
		t.Run(tt.lang, func(t *testing.T) {
			got := LangToTesseract(tt.lang)
			if got != tt.want {
				t.Errorf("LangToTesseract(%q) = %q, want %q", tt.lang, got, tt.want)
			}
		})
	}
}

func TestLevenshtein(t *testing.T) {
	tests := []struct {
		a    string
		b    string
		want int
	}{
		{"", "", 0},
		{"abc", "", 3},
		{"", "abc", 3},
		{"abc", "abc", 0},
		{"abc", "abd", 1},
		{"kitten", "sitting", 3},
		{"saturday", "sunday", 3},
		{"a", "b", 1},
	}

	for _, tt := range tests {
		t.Run(tt.a+"_"+tt.b, func(t *testing.T) {
			got := levenshtein(tt.a, tt.b)
			if got != tt.want {
				t.Errorf("levenshtein(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestUpscale3x(t *testing.T) {
	src := solidImage(10, 20, color.RGBA{100, 100, 100, 255})
	result := upscale3x(src)
	b := result.Bounds()
	if b.Dx() != 30 || b.Dy() != 60 {
		t.Errorf("upscale3x(%d×%d) = %d×%d, want %d×%d", 10, 20, b.Dx(), b.Dy(), 30, 60)
	}
}

func TestUpscale3x_PreservesContent(t *testing.T) {
	// A single-color image should remain uniform after upscaling
	c := color.RGBA{42, 42, 42, 255}
	src := solidImage(5, 5, c)
	result := upscale3x(src)
	b := result.Bounds()
	rgba, ok := result.(*image.RGBA)
	if !ok {
		t.Fatal("upscale3x did not return *image.RGBA")
	}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, b2, _ := rgba.At(x, y).RGBA()
			// Compare in 8-bit range
			if uint8(r>>8) != c.R || uint8(g>>8) != c.G || uint8(b2>>8) != c.B {
				t.Fatalf("upscale3x pixel (%d,%d) color mismatch", x, y)
			}
		}
	}
}
