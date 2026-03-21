# Encounty

Encounty is a modern, open-source encounter tracker for Pokémon games. It uses text and image recognition to automatically detect and count encounters, enabling unlimited multi-hunts — limited only by your hardware. Manual tracking via global hotkeys is also supported.

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

## Download

**[⬇ Download the latest version here](https://github.com/ZSleyer/Encounty/releases/latest)**

Choose the file matching your operating system:

- **Windows**: `Encounty.exe`
- **Linux**: `Encounty.AppImage`

All releases can be found on the [Releases](https://github.com/ZSleyer/Encounty/releases) page.

## Contributing

Pull requests are welcome! Whether it's translations, new features, or bug fixes — feel free to contribute.

## Development

### Prerequisites

- Go 1.25+
- Node.js 18+ & Yarn
- Make

### Architecture

Encounty uses a clean frontend/backend separation:

- **Go backend** — pure API server and state coordinator (`/api/*`, `/ws`)
- **Rust sidecar** — high-performance GPU capture (PipeWire/DXGI) & NCC matching
- **Electron** — serves the frontend via a custom `encounty://` protocol
- **Vite** — dev server with proxy to Go backend for development

```text
backend/          Go API server (REST + WebSocket)
  internal/
    server/       HTTP handlers (split by domain)
    detector/     Sidecar manager + detection state machine
    gamesync/     Game catalogue + PokéAPI sync
    pokedex/      Pokédex data + GraphQL sync
    updater/      Auto-update + platform binary replacement
    state/        In-memory state manager
    database/     SQLite persistence (normalized v2 schema)
    hotkeys/      Platform-native global hotkeys
    fileoutput/   OBS text file integration
frontend/         React + TypeScript SPA (Vite, Tailwind CSS, Zustand)
electron/         Electron wrapper (custom protocol, process manager)
```

### Running in Development

```bash
# Option 1: Make (backend + frontend, no Electron)
make dev

# Option 2: VS Code (use "Full Dev + Electron" compound launch config)

# Option 3: Manual
cd backend && go run main.go --dev          # Terminal 1: Go API server
cd frontend && yarn dev                      # Terminal 2: Vite dev server
cd electron && yarn dev                      # Terminal 3: Electron (optional)
```

The Vite dev server (`:5173`) proxies `/api` and `/ws` to the Go backend (`:8080`).
Electron in dev mode loads from Vite and does not spawn its own Go process.

### API Documentation

Swagger UI is available at `http://localhost:8080/swagger/` when the backend is running.

### Building from Source

```bash
make build                       # Go binaries for Linux + Windows (API-only)
make electron-package-linux      # Electron AppImage (bundles Go + frontend)
make electron-package-windows    # Electron portable exe
make swagger                     # Regenerate OpenAPI spec
make test                        # Run Go + frontend tests
```

## Support

Encounty is a hobby project provided free of charge. There is no official support.

## License

This project is licensed under the [GNU Affero General Public License v3 (AGPLv3)](LICENSE).
