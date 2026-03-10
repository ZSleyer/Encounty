# Encounty

Encounty is a modern Pokémon Shiny Encounter Counter and Tracker. It provides a customizable dashboard and OBS overlays for shiny hunters.

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

Ready-to-use binaries for Windows and Linux can be found on the [GitHub Releases](https://github.com/ZSleyer/Encounty/releases) page.

## Development

### Prerequisites

- Go (1.22 or later)
- Node.js & Yarn

### Running in Development

```bash
# Terminal 1: Frontend
cd frontend && yarn install && yarn dev

# Terminal 2: Backend
go run main.go --dev
```

### Building from Source

```bash
make build
```

This will generate binaries for both Linux and Windows.

## License

This project is licensed under the GNU Affero General Public License Version 3 (AGPLv3). See the [LICENSE](LICENSE) file for details.
