# Encounty

Encounty is a modern Pokémon Shiny Encounter Counter and Tracker. It provides a customizable dashboard and OBS overlays for shiny hunters.

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
