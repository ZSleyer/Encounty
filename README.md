# Encounty

[![CI](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![Backend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ZSleyer/Encounty/badges/backend-coverage.json)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![Frontend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ZSleyer/Encounty/badges/frontend-coverage.json)](https://github.com/ZSleyer/Encounty/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/github/license/ZSleyer/Encounty)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/ZSleyer/Encounty)](https://github.com/ZSleyer/Encounty/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ZSleyer/Encounty/total)](https://github.com/ZSleyer/Encounty/releases)

Encounty is a modern, open-source encounter tracker for Pokemon shiny hunting. It captures your game screen directly in the browser, runs GPU-accelerated template matching to detect encounters automatically, and supports unlimited parallel hunts — limited only by your hardware.

## Download

**[Download the latest version here](https://github.com/ZSleyer/Encounty/releases/latest)**

| Platform                   | Architecture | File                        |
|----------------------------|--------------|-----------------------------|
| Linux (Wayland)            | x64          | `Encounty.AppImage`         |
| macOS Tahoe (26+)          | arm64        | `Encounty.zip`    |
| Windows 11 (26H1+)         | x64          | `Encounty.exe`              |

## How It Works

1. The browser captures your screen, window, or camera feed per Pokemon via `getDisplayMedia` / `getUserMedia`
2. WebGPU compute shaders run a 4-metric hybrid match (SSIM, NCC, MAD, histogram correlation) directly on the GPU — with automatic CPU fallback and buffer pooling for minimal allocation overhead
3. Hysteresis, consecutive-hit confirmation, and a configurable cooldown prevent false positives and double-counts
4. A confirmed match increments the encounter counter and broadcasts the result via WebSocket to the dashboard and OBS overlays

### Features

- Unlimited simultaneous multi-hunts with independent capture streams
- Template management with single-active selection, import/export, and region-based positive/negative matching
- Manual tracking via configurable platform-native global hotkeys (evdev on Linux, CGEventTap on macOS, Win32 on Windows)
- OBS integration via overlay editor (drag-and-drop, live preview) and text file output
- Single-instance protection with zombie process detection

## Contributing

Pull requests are welcome — translations, features, bug fixes, or documentation.

## Development

### Prerequisites

| Tool    | Version | Purpose             |
|---------|---------|---------------------|
| Go      | 1.25+   | Backend API server  |
| Node.js | 22+     | Frontend + Electron |
| Yarn    | any     | Package manager     |
| Make    | any     | Build orchestration |

### Architecture

Encounty uses a two-process architecture:

- **Go backend** (`localhost:8192`) — REST API, WebSocket hub, SQLite persistence, hotkeys, file output, and OBS overlay serving
- **Electron** — desktop shell managing the Go process lifecycle; hosts the browser-based capture and detection engine

Detection state flows unidirectionally: Go backend (in-memory + SQLite) → WebSocket → Zustand store → React UI.

```text
backend/          Go API server (REST + WebSocket)
  internal/
    server/       HTTP handlers, WebSocket hub, Swagger UI
    state/        In-memory state manager
    database/     SQLite persistence (normalized v2 schema)
    detector/     Detection state machine (score-based)
    hotkeys/      Platform-native global hotkeys (evdev / CGEventTap / Win32)
    fileoutput/   OBS text file integration
    gamesync/     Game catalogue + PokeAPI sync
    pokedex/      Pokedex data + GraphQL sync
frontend/         React + TypeScript SPA (Vite, Tailwind CSS 4, Zustand)
  src/engine/     WebGPU detection engine (WGSL compute shaders)
  src/contexts/   CaptureService (per-Pokemon MediaStream management)
electron/         Electron wrapper (custom protocol, process manager)
```

### Quick Start

```bash
make dev    # Starts Vite dev server (:5173) and Go backend (:8192)
```

Or manually in separate terminals:

```bash
cd backend  && go run -ldflags="-X main.version=dev" main.go --dev
cd frontend && yarn dev
cd electron && yarn dev    # optional
```

The Vite dev server proxies `/api` and `/ws` to the Go backend. Electron in dev mode loads from Vite and does not spawn its own Go process.

### Building

```bash
make build-linux               # Linux x64 binary
make build-windows             # Windows x64 binary
make build-macos               # macOS arm64 binary (requires CGO)
make electron-package-linux    # Electron AppImage (Linux x64)
make electron-package-windows  # Electron portable exe (Windows x64)
make electron-package-macos    # Electron zip (macOS arm64)
make test                      # Go + frontend tests
make clean                     # Remove build artifacts
```

### API

Swagger UI: `http://localhost:8192/swagger/`

## License

[GNU Affero General Public License v3 (AGPLv3)](LICENSE)
