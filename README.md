# Encounty

Encounty is a modern, open-source encounter tracker for Pokémon games. It uses text and image recognition to automatically detect and count encounters, enabling unlimited multi-hunts — limited only by your hardware. Manual tracking via global hotkeys is also supported.

## Download

**[⬇ Download the latest version here](https://github.com/ZSleyer/Encounty/releases/latest)**

Choose the file matching your operating system:

- **Windows**: `Encounty.exe`
- **Linux**: `Encounty.AppImage`

All releases can be found on the [Releases](https://github.com/ZSleyer/Encounty/releases) page.

## Support

Encounty is a hobby project provided free of charge. There is no official support.

## Compatibility

The application is currently only tested on and known to be compatible with:

- **Linux**: Wayland only (no X11/Xwayland support for capture; tested on Arch Linux)
- **Windows**: Windows 11 only (version 21H2+)

> [!IMPORTANT]
> macOS and other Linux/Windows versions are currently unsupported as of 2026, and there are no plans to support them.

## Features

- **GPU-accelerated** encounter tracking via high-performance NCC template matching
- Unlimited simultaneous multi-hunts with minimal CPU overhead
- Manual tracking with configurable global hotkeys
- Customizable dashboard with real-time stats
- OBS overlay editor with drag-and-drop and live preview

![Dashboard](docs/images/dashboard.png)
*Modern, customizable dashboard with real-time stats.*

![Overlay Editor](docs/images/overlay_editor.png)
*Powerful overlay editor with drag-and-drop and real-time preview.*

![Auto-Detection](docs/images/auto_detection.png)
*Auto-detection system for encounter counting.*

![Auto-Detection Templates](docs/images/auto_detection_templates.png)
*Auto-detection templates for encounter counting.*

## Contributing

Pull requests are welcome! Whether it's translations, new features, or bug fixes — feel free to contribute.

## Development

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Go | 1.25+ | Backend API server |
| Node.js | 22+ | Frontend build |
| Yarn | any | Package manager (`npm install -g yarn`) |
| Rust | stable | Capture sidecar (`rustup install stable`) |
| Make | any | Build orchestration |

**Linux only** — additional system packages required to build the Rust sidecar:

```bash
# Arch Linux
sudo pacman -S pipewire pkg-config clang

# Ubuntu / Debian
sudo apt-get install -y libpipewire-0.3-dev pkg-config libclang-dev libudev-dev
```

### Architecture

Encounty uses a three-process architecture:

- **Rust sidecar** (`encounty-capture`) — screen/window/camera capture via PipeWire (Linux) or DXGI (Windows); CPU-based NCC template matching; communicates with the backend over stdin/stdout using newline-delimited JSON + binary frames
- **Go backend** — pure API server and state coordinator (`/api/*`, `/ws`); spawns and manages the sidecar subprocess
- **Electron** — desktop shell; serves the frontend via a custom `encounty://` protocol and manages the Go process lifecycle
- **Vite** — dev server with proxy to the Go backend for development (no Electron needed)

```text
backend/          Go API server (REST + WebSocket)
  internal/
    server/       HTTP handlers (split by domain)
    detector/     Sidecar process manager + detection state machine
    gamesync/     Game catalogue + PokéAPI sync
    pokedex/      Pokédex data + GraphQL sync
    updater/      Auto-update + platform binary replacement
    state/        In-memory state manager
    database/     SQLite persistence (normalized v2 schema)
    hotkeys/      Platform-native global hotkeys (evdev / Win32)
    fileoutput/   OBS text file integration
capture-sidecar/  Rust sidecar (capture + NCC matching)
  src/
    capture/      Screen, window, camera backends (PipeWire / xcap / nokhwa)
    detection/    Capture-and-match session registry
    match_engine/ CPU NCC implementation
    protocol.rs   stdin/stdout wire protocol types
frontend/         React + TypeScript SPA (Vite, Tailwind CSS 4, Zustand)
electron/         Electron wrapper (custom protocol, process manager)
```

### Running in Development

The backend automatically locates the sidecar binary at
`../capture-sidecar/target/{debug,release}/encounty-capture` relative to its
working directory, so a one-time sidecar build is all that is required.

```bash
# 1. Build the sidecar once (re-run only when capture-sidecar/ changes)
cd capture-sidecar && cargo build && cd ..

# 2a. Start backend + frontend via Make
make dev

# 2b. Or start each process manually in separate terminals
cd backend  && go run -ldflags="-X main.version=dev" main.go --dev   # :8080
cd frontend && yarn dev                                                # :5173
cd electron && yarn dev                                                # optional Electron window
```

The Vite dev server (`:5173`) proxies `/api` and `/ws` to the Go backend (`:8080`).
Electron in dev mode loads from Vite and does not spawn its own Go process.

### API Documentation

Swagger UI is available at `http://localhost:8080/swagger/` when the backend is running.

### Building from Source

```bash
# Rust sidecar
make build-sidecar-linux       # Linux binary → dist-linux/encounty-capture
make build-sidecar-windows     # Windows binary → dist-windows/encounty-capture.exe

# Go backend (requires sidecar to be built first for a complete bundle)
make build-linux               # Linux amd64 binary + dist-linux/ bundle
make build-windows             # Windows amd64 binary

# Electron desktop app (bundles Go backend, frontend, and sidecar)
make electron-package-linux    # AppImage
make electron-package-windows  # Portable exe

# Everything at once
make build-all-with-sidecar    # Sidecar + backends + Electron packages

# Utilities
make swagger                   # Regenerate OpenAPI spec
make test                      # Go + frontend + Rust tests
make coverage                  # Coverage reports (filtered)
make clean                     # Remove all build artifacts
```

### Testing

```bash
make test                            # All tests (Go + frontend)
cd capture-sidecar && cargo test     # Rust unit tests
```

The Wayland portal test (`wayland_screen_capture_receives_frame`) is marked
`#[ignore]` and requires an interactive compositor dialog. Run it manually with:

```bash
cd capture-sidecar && cargo test -- --ignored
```

## License

This project is licensed under the [GNU Affero General Public License v3 (AGPLv3)](LICENSE).
