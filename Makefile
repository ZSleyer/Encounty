.PHONY: dev build build-windows build-linux frontend clean

BINARY = encounty
FRONTEND_DIR = frontend
LDFLAGS         = -ldflags="-s -w"
LDFLAGS_WINDOWS = -ldflags="-s -w -H=windowsgui"

dev:
	@echo "Starting Encounty in dev mode..."
	@cd $(FRONTEND_DIR) && yarn dev &
	@go run main.go --dev

frontend:
	@echo "Building frontend..."
	@cd $(FRONTEND_DIR) && yarn build

build: frontend
	@echo "Building Encounty..."
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
