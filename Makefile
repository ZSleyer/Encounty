.PHONY: dev build build-windows build-linux frontend clean

BINARY = encounty
FRONTEND_DIR = frontend
LINUX_DIST = dist-linux

# Capture git info at make-time
COMMIT  := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
# Use the exact tag if HEAD is tagged, otherwise "dev"
VERSION := $(shell git describe --tags --exact-match 2>/dev/null || echo "dev")

# Base ldflags: strip debug symbols + inject version/commit
_BASE_LDFLAGS = -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT)
LDFLAGS         = -ldflags="$(_BASE_LDFLAGS)"
LDFLAGS_WINDOWS = -ldflags="$(_BASE_LDFLAGS) -H=windowsgui"

dev:
	@echo "Starting Encounty in dev mode (commit=$(COMMIT))..."
	@cd $(FRONTEND_DIR) && yarn dev &
	@go run -ldflags="-X main.version=dev -X main.commit=$(COMMIT)" main.go --dev

frontend:
	@echo "Building frontend..."
	@cd $(FRONTEND_DIR) && yarn build

build: build-linux build-windows
all: build

icons:
	@echo "Generating icons from frontend/public/app-icon.png..."
	go run scripts/generate_icons.go

build-linux: frontend icons
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

build-windows: frontend icons
	@command -v go-winres >/dev/null 2>&1 || (echo "Installing go-winres..." && go install github.com/tc-hib/go-winres@latest)
	@# Extract numeric version for Windows (v1.2.3 -> 1.2.3.0)
	$(eval WIN_VER := $(shell echo $(VERSION) | sed 's/v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+' || echo "0.2.0"))
	@echo "Generating Windows resources (Version: $(WIN_VER).0)..."
	@~/go/bin/go-winres make --product-version "$(WIN_VER).0" --file-version "$(WIN_VER).0"
	@CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build $(LDFLAGS_WINDOWS) -o $(BINARY)-windows.exe .
	@# Cleanup generated resource files
	@rm -f *.syso
	@command -v upx >/dev/null 2>&1 && upx --best --compress-icons=0 $(BINARY)-windows.exe || true
	@echo "Done: ./$(BINARY)-windows.exe"

clean:
	rm -f $(BINARY) $(BINARY)-linux $(BINARY)-windows.exe *.syso
	rm -rf $(FRONTEND_DIR)/dist $(LINUX_DIST)
