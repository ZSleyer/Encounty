# Encounty

[![CI](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![Backend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ZSleyer/Encounty/badges/backend-coverage.json)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![Frontend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ZSleyer/Encounty/badges/frontend-coverage.json)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/github/license/ZSleyer/Encounty)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/ZSleyer/Encounty)](https://github.com/ZSleyer/Encounty/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ZSleyer/Encounty/total)](https://github.com/ZSleyer/Encounty/releases)

Encounty is a modern, open-source auto shiny counter for Pokemon shiny hunting. It captures your game screen directly in the app, runs GPU-accelerated template matching to detect encounters automatically, and supports unlimited parallel hunts, limited only by your hardware. Everything runs locally: no account, no cloud, no paywall.

**[Website](https://zsleyer.github.io/Encounty/)** · **[Download & install guide](https://zsleyer.github.io/Encounty/update.html)** · **[Changelog](https://zsleyer.github.io/Encounty/changelog.html)**

## Download

**[Download Encounty for Linux, macOS, and Windows](https://github.com/ZSleyer/Encounty/releases/latest)**

| Platform                   | Architecture | File                          |
|----------------------------|--------------|-------------------------------|
| Linux (Wayland)            | x64          | `Encounty-x86_64.AppImage`       |
| Linux (Wayland)            | arm64        | `Encounty-arm64.AppImage`     |
| macOS (26+)                | arm64        | `Encounty-arm64.dmg`          |
| Windows 11 (26H1+)         | x64 + arm64  | `Encounty-Setup.exe`          |

## How It Works

1. Capture your game screen, window, or camera feed (one source per hunt)
2. Encounty compares each frame against your template images on the GPU to detect encounters automatically
3. Built-in safeguards prevent false positives and double-counts
4. Every confirmed encounter updates your counter in real time, including any connected OBS overlays

## Features

### Detection engine

- **GPU-accelerated auto-detection** via WebGPU compute shaders with automatic CPU/worker fallback, easy on your CPU while you play
- **Multi-metric matching**: every frame is scored by a fusion of block SSIM, Pearson correlation, mean absolute difference, and histogram correlation instead of a single naive pixel diff
- **Position- and scale-tolerant sprite matching** through true NCC template matching with integral images and multi-scale search, so a region does not have to sit pixel-perfect
- **No double counting**: a three-phase hysteresis state machine (latch, cooldown, count) with miss tolerance and noise-floor handling makes sure each encounter is counted exactly once
- **Replay-based screenshots**: pick the perfect template frame from a replay recording instead of hoping to hit the right moment
- **Automatic stability analysis**: every template is analysed up front and Encounty tells you how reliably it will match before you start hunting, including data-driven parameter calibration
- **Guided template creation** in a step-by-step flow: snapshot, mark the encounter text, test the match, done
- **Adaptive polling** (50 ms to 2 s) with frame-change gating keeps idle CPU usage near zero

### Hunt tracking

- **All mainline Pokémon games** from Gen 1 (Red/Blue/Yellow) through Gen 9 (Legends Z-A) with game-specific shiny odds
- **60+ hunt methods** including Masuda, Poké Radar, SOS chaining, DexNav, Mass Outbreaks, Sandwich hunts, and many more, each with its own odds model
- **Shiny Charm toggle** with accurate per-method odds for every supported game
- **Unlimited simultaneous hunts** with independent capture streams
- **Manual tracking** via configurable global hotkeys

### Streaming & extras

- **OBS integration** with drag-and-drop overlay editor, live preview, and text file output
- **Template import/export** to share detection templates or move them between machines
- **Pokédex** with sprite support and PokeAPI sync
- **Multi-language** support for English, German, Spanish, French, and Japanese

### Privacy & platform

- **Local-first**: works offline, no account, no cloud dependency; your hunts stay on your machine
- **Free**: no ads, no paywall, no pro tier
- **Cross-platform & multi-arch**: Linux (Wayland), Windows 11, and macOS on x64 and ARM64. Coming soon to your Toaster™
- **Open source** under AGPL-3.0 with tested, typed code (Go backend, React frontend, Electron shell)

## Troubleshooting

- [Linux](https://zsleyer.github.io/Encounty/update.html#linux)
- [macOS](https://zsleyer.github.io/Encounty/update.html#macos)

## Contributing

Pull requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture, and build instructions. Encounty was built with the help of LLM coding assistants, without them a project of this scope wouldn't have been possible to build solo in this timeframe, so PRs created with the help of LLM agents are explicitly welcome too.

## License Notice

This project is licensed under the [GNU Affero General Public License v3 (AGPLv3)](LICENSE).

You are free to use, modify, and redistribute this software, provided that you fully comply with the terms of the AGPLv3. If you modify this software and make it available over a network or distribute it in any form, you must fulfill all obligations imposed by the license, including making the complete corresponding source code available.

Any use of this source code outside the permissions granted by the AGPLv3, including incorporating it into proprietary software without complying with the license, constitutes copyright infringement.

The author actively protects this project's intellectual property and reserves the right to investigate and pursue any license violations through all available legal remedies.


## Star History

<a href="https://www.star-history.com/?repos=ZSleyer%2Fencounty&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ZSleyer/encounty&type=timeline&theme=dark&legend=bottom-right&sealed_token=YOwMAjeEn0LotAQU9XbXeol6XVNUTJK9eIf0mQtxdxy9nCB2iA-jagDy64HlwPTMFmS7eFqq83uCdYW0Mo8tPq3BBHqkVpmshujyGIxWYkGLw7fGIBIfG7y_naAFHOeWwVS7FmMDeROUs5x7zUxYJJqTsB8Qcv29uS1tbTPQaWV69ZJQkTlAzaMW7WpW" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ZSleyer/encounty&type=timeline&legend=bottom-right&sealed_token=YOwMAjeEn0LotAQU9XbXeol6XVNUTJK9eIf0mQtxdxy9nCB2iA-jagDy64HlwPTMFmS7eFqq83uCdYW0Mo8tPq3BBHqkVpmshujyGIxWYkGLw7fGIBIfG7y_naAFHOeWwVS7FmMDeROUs5x7zUxYJJqTsB8Qcv29uS1tbTPQaWV69ZJQkTlAzaMW7WpW" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ZSleyer/encounty&type=timeline&legend=bottom-right&sealed_token=YOwMAjeEn0LotAQU9XbXeol6XVNUTJK9eIf0mQtxdxy9nCB2iA-jagDy64HlwPTMFmS7eFqq83uCdYW0Mo8tPq3BBHqkVpmshujyGIxWYkGLw7fGIBIfG7y_naAFHOeWwVS7FmMDeROUs5x7zUxYJJqTsB8Qcv29uS1tbTPQaWV69ZJQkTlAzaMW7WpW" />
 </picture>
</a>
