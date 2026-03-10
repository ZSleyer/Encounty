package main

import "testing"

func TestFormatVersionDisplay(t *testing.T) {
	tests := []struct {
		name string
		ver  string
		date string
		cmt  string
		want string
	}{
		{
			name: "release version",
			ver:  "v0.2.0",
			date: "032026",
			cmt:  "abc1234",
			want: "v0.2.0-032026-abc1234",
		},
		{
			name: "dev version",
			ver:  "dev",
			date: "032026",
			cmt:  "abc1234",
			want: "dev-032026-abc1234",
		},
		{
			name: "empty fields",
			ver:  "v1.0.0",
			date: "",
			cmt:  "",
			want: "v1.0.0--",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatVersionDisplay(tt.ver, tt.date, tt.cmt)
			if got != tt.want {
				t.Errorf("formatVersionDisplay(%q, %q, %q) = %q, want %q",
					tt.ver, tt.date, tt.cmt, got, tt.want)
			}
		})
	}
}
