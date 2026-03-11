.PHONY: dev build build-windows build-linux frontend clean licenses test coverage

BINARY = encounty
FRONTEND_DIR = frontend
LINUX_DIST = dist-linux

# Capture git info at make-time
COMMIT  := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
# Use the exact tag if HEAD is tagged, otherwise "dev"
VERSION := $(shell git describe --tags --exact-match 2>/dev/null || echo "dev")
BUILD_DATE := $(shell date +%d.%m.%y)

# Base ldflags: strip debug symbols + inject version/commit
_BASE_LDFLAGS = -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildDate=$(BUILD_DATE)
LDFLAGS         = -ldflags="$(_BASE_LDFLAGS)"
LDFLAGS_WINDOWS = -ldflags="$(_BASE_LDFLAGS) -H=windowsgui"

dev:
	@echo "Starting Encounty in dev mode (commit=$(COMMIT))..."
	@cd $(FRONTEND_DIR) && yarn dev &
	@go run -ldflags="-X main.version=dev -X main.commit=$(COMMIT) -X main.buildDate=$(BUILD_DATE)" main.go --dev

licenses:
	@echo "Collecting third-party licenses..."
	@bash scripts/collect_licenses.sh

frontend:
	@echo "Building frontend..."
	@cd $(FRONTEND_DIR) && yarn build

build: build-linux build-windows
all: build

icons:
	@echo "Generating icons from frontend/public/app-icon.png..."
	go run scripts/generate_icons.go

build-linux: frontend icons licenses
	@echo "Building Encounty $(VERSION) ($(COMMIT)) for Linux..."
	@GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BINARY)-linux main.go
	@command -v upx >/dev/null 2>&1 && upx --best $(BINARY)-linux || true
	@# Prepare Linux distribution bundle
	@mkdir -p $(LINUX_DIST)
	@cp $(BINARY)-linux $(LINUX_DIST)/$(BINARY)
	@cp winres/icon.png $(LINUX_DIST)/icon.png
	@echo "[Desktop Entry]" > $(LINUX_DIST)/$(BINARY).desktop
	@echo "Name=Encounty" >> $(LINUX_DIST)/$(BINARY).desktop
	@echo "Comment=Pokémon Shiny Encounter Counter & Tracker" >> $(LINUX_DIST)/$(BINARY).desktop
	@echo "Exec=$(PWD)/$(LINUX_DIST)/$(BINARY)" >> $(LINUX_DIST)/$(BINARY).desktop
	@echo "Icon=$(PWD)/$(LINUX_DIST)/icon.png" >> $(LINUX_DIST)/$(BINARY).desktop
	@echo "Terminal=false" >> $(LINUX_DIST)/$(BINARY).desktop
	@echo "Type=Application" >> $(LINUX_DIST)/$(BINARY).desktop
	@echo "Categories=Game;Utility;" >> $(LINUX_DIST)/$(BINARY).desktop
	@echo "Done: ./$(LINUX_DIST)/ (Run ./$(BINARY) or use the .desktop file)"

build-windows: frontend icons licenses
	$(eval WINRES := $(shell go env GOPATH)/bin/go-winres)
	@command -v $(WINRES) >/dev/null 2>&1 || (echo "Installing go-winres..." && go install github.com/tc-hib/go-winres@latest)
	@# Extract numeric version for Windows (v1.2.3 -> 1.2.3.0, v0.3 -> 0.3.0)
	$(eval WIN_VER := $(shell echo $(VERSION) | sed 's/v//' | grep -oE '^[0-9]+\.[0-9]+(\.[0-9]+)?' | awk -F. '{if(NF==2) print $$0".0"; else print $$0}' || echo "0.3.0"))
	@echo "Generating Windows resources (Version: $(WIN_VER).0)..."
	@$(WINRES) make --product-version "$(WIN_VER).0" --file-version "$(WIN_VER).0"
	@CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build $(LDFLAGS_WINDOWS) -o $(BINARY)-windows.exe .
	@# Cleanup generated resource files
	@rm -f *.syso
	@command -v upx >/dev/null 2>&1 && upx --best --compress-icons=0 $(BINARY)-windows.exe || true
	@echo "Done: ./$(BINARY)-windows.exe"

# ── Go files excluded from coverage (platform-specific / untestable) ──
# Platform managers & keycodes  — OS-level evdev/HID/input API
# Capture, Sound              — cgo/screenshot, audio subsystem
# Reexec / update platform    — syscall.Exec, binary replacement
# update.go                   — GitHub API + platform binary swap
# games_sync / pokedex        — external PokéAPI HTTP calls
# detector_api                — tightly coupled to capture + filesystem
# detector.go, ocr.go         — main loop needs screen capture; OCR needs tesseract
# main.go / scripts           — entry points with os.Exit / signal handling
GO_COVERAGE_EXCLUDE = manager_linux\.go|manager_windows\.go|manager_darwin\.go|\
keycodes_linux\.go|keycodes_windows\.go|\
capture\.go|sound_unix\.go|sound_windows\.go|\
reexec_unix\.go|reexec_windows\.go|\
update_unix\.go|update_windows\.go|update\.go|\
games_sync\.go|detector_api\.go|detector\.go|\
ocr\.go|pokedex\.go|\
main\.go|scripts/generate_icons\.go

test:
	@echo "=== Go Tests ==="
	@go test ./... -count=1
	@echo ""
	@echo "=== Frontend Tests ==="
	@cd $(FRONTEND_DIR) && yarn test

coverage:
	@echo "=== Go Coverage (filtered) ==="
	@go test ./... -coverprofile=coverage.out -count=1
	@grep -vE '$(GO_COVERAGE_EXCLUDE)' coverage.out > coverage_filtered.out
	@go tool cover -func=coverage_filtered.out | tail -1
	@echo ""
	@echo "=== Go Coverage by package (filtered) ==="
	@go tool cover -func=coverage_filtered.out | grep 'total\|^[^ ]' | grep -v '100.0%' || echo "All functions at 100%!"
	@echo ""
	@echo "=== Frontend Coverage ==="
	@cd $(FRONTEND_DIR) && yarn vitest run --coverage
	@rm -f coverage.out coverage_filtered.out

clean:
	rm -f $(BINARY) $(BINARY)-linux $(BINARY)-windows.exe *.syso
	rm -rf $(FRONTEND_DIR)/dist $(LINUX_DIST)
