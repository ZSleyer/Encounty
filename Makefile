.PHONY: dev build build-windows build-linux frontend clean

BINARY = encounty
FRONTEND_DIR = frontend

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

build: frontend
	@echo "Building Encounty $(VERSION) ($(COMMIT))..."
	go build $(LDFLAGS) -o $(BINARY) main.go
	@command -v upx >/dev/null 2>&1 && upx --best $(BINARY) || true
	@echo "Done: ./$(BINARY)"

build-linux: frontend
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BINARY)-linux main.go
	@command -v upx >/dev/null 2>&1 && upx --best $(BINARY)-linux || true
	@echo "Done: ./$(BINARY)-linux"

build-windows: frontend
	@command -v go-winres >/dev/null 2>&1 || (echo "Installing go-winres..." && go install github.com/tc-hib/go-winres@latest)
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build $(LDFLAGS_WINDOWS) -o $(BINARY)-windows.exe main.go
	@~/go/bin/go-winres patch $(BINARY)-windows.exe || echo "Warning: go-winres patch failed, icon may not be included"
	@command -v upx >/dev/null 2>&1 && upx --best --compress-icons=0 $(BINARY)-windows.exe || true
	@echo "Done: ./$(BINARY)-windows.exe"

clean:
	rm -f $(BINARY) $(BINARY)-linux $(BINARY)-windows.exe
	rm -rf $(FRONTEND_DIR)/dist
