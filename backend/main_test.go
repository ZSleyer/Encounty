package main

import "testing"

func TestFormatVersionDisplay(t *testing.T) {
	tests := []struct {
		name string
		ver  string
		cmt  string
		want string
	}{
		{
			name: "release version",
			ver:  "v0.3",
			cmt:  "abc1234",
			want: "v0.3-abc1234",
		},
		{
			name: "dev version",
			ver:  "dev",
			cmt:  "abc1234",
			want: "dev-abc1234",
		},
		{
			name: "empty commit",
			ver:  "v1.0.0",
			cmt:  "",
			want: "v1.0.0-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatVersionDisplay(tt.ver, tt.cmt)
			if got != tt.want {
				t.Errorf("formatVersionDisplay(%q, %q) = %q, want %q",
					tt.ver, tt.cmt, got, tt.want)
			}
		})
	}
}
