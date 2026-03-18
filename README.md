# Encounty

Encounty is a modern, open-source encounter tracker for Pokémon games. It uses text and image recognition to automatically detect and count encounters, enabling unlimited multi-hunts — limited only by your hardware. Manual tracking via global hotkeys is also supported.

The application was developed on Arch Linux with Wayland but is also available for Windows.

## Features

- Automatic encounter tracking via text and image recognition
- Unlimited simultaneous multi-hunts
- Manual tracking with configurable global hotkeys
- Customizable dashboard with real-time stats
- OBS overlay editor with drag-and-drop and live preview

<div>
  <img src="docs/images/dashboard.png" width="800" alt="Dashboard">
  <br>
  <em>Modern, customizable dashboard with real-time stats.</em>
</div>

<div>
  <img src="docs/images/overlay_editor.png" width="800" alt="Overlay Editor">
  <br>
  <em>Powerful overlay editor with drag-and-drop and real-time preview.</em>
</div>

<div>
  <img src="docs/images/auto_detection.png" width="800" alt="Auto-Detection">
  <br>
  <em>Auto-detection system for encounter counting.</em>
</div>

<div>
  <img src="docs/images/auto_detection_templates.png" width="800" alt="Auto-Detection Templates">
  <br>
  <em>Auto-detection templates for encounter counting.</em>
</div>

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

- Go 1.24+
- Node.js 18+ & Yarn
- Make

### Running in Development

```bash
make dev
```

This starts both the Vite dev server (`:5173`) and the Go backend (`:8080`) with hot-reload.

### Building from Source

```bash
make build              # Cross-compile for Linux and Windows
make electron-package-linux    # Build Linux AppImage
make electron-package-windows  # Build Windows portable exe
```

### Project Structure

```
backend/     Go backend (HTTP + WebSocket server, embeds frontend)
frontend/    React + TypeScript SPA (Vite, Tailwind CSS, Zustand)
electron/    Electron wrapper for desktop packaging
```

## Support

Encounty is a hobby project provided free of charge. There is no official support.

## License

This project is licensed under the [GNU Affero General Public License v3 (AGPLv3)](LICENSE).
