//go:build linux

package hotkeys

import "golang.design/x/hotkey"

func modAlt() hotkey.Modifier { return hotkey.Mod1 }
