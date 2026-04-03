# Encounty

[![CI](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![Backend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ZSleyer/Encounty/badges/backend-coverage.json)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![Frontend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ZSleyer/Encounty/badges/frontend-coverage.json)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/github/license/ZSleyer/Encounty)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/ZSleyer/Encounty)](https://github.com/ZSleyer/Encounty/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ZSleyer/Encounty/total)](https://github.com/ZSleyer/Encounty/releases)

Encounty is a modern, open-source encounter tracker for Pokemon shiny hunting. It captures your game screen directly in the browser, runs GPU-accelerated template matching to detect encounters automatically, and supports unlimited parallel hunts, limited only by your hardware.

## Download

**[Download the latest version here](https://github.com/ZSleyer/Encounty/releases/latest)**

| Platform                   | Architecture | File                        |
|----------------------------|--------------|-----------------------------|
| Linux (Wayland)            | x64          | `Encounty.AppImage`         |
| macOS (26+)                | arm64        | `Encounty.dmg`              |
| Windows 11 (26H1+)         | x64          | `Encounty.exe`              |

## How It Works

1. Capture your game screen, window, or camera feed (one source per hunt)
2. Encounty compares each frame against your template images on the GPU to detect encounters automatically
3. Built-in safeguards prevent false positives and double-counts
4. Every confirmed encounter updates your counter in real time, including any connected OBS overlays

### Features

- **All mainline Pokémon games** from Gen 1 (Red/Blue/Yellow) through Gen 9 (Legends Z-A) with game-specific shiny odds
- **60+ hunt methods** including Masuda, Poké Radar, SOS chaining, DexNav, Mass Outbreaks, Sandwich hunts, and many more
- **Shiny Charm toggle** with accurate per-method odds for every supported game
- **Unlimited simultaneous hunts** with independent capture streams
- **GPU-accelerated auto-detection** via WebGPU compute shaders with automatic CPU fallback
- **Template management** with import/export and region-based positive/negative matching
- **Manual tracking** via configurable global hotkeys
- **OBS integration** with drag-and-drop overlay editor, live preview, and text file output
- **Pokédex** with sprite support and PokeAPI sync
- **Multi-language** support for English, German, Spanish, French, and Japanese

## Contributing

Pull requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture, and build instructions.

## License

[GNU Affero General Public License v3 (AGPLv3)](LICENSE)
