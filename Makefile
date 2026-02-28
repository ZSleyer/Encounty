.PHONY: dev build build-windows build-linux frontend clean

BINARY = encounty
FRONTEND_DIR = frontend

dev:
	@echo "Starting Encounty in dev mode..."
	@cd $(FRONTEND_DIR) && yarn dev &
	@go run main.go --dev

frontend:
	@echo "Building frontend..."
	@cd $(FRONTEND_DIR) && yarn build

build: frontend
	@echo "Building Encounty..."
	go build -ldflags="-s -w" -o $(BINARY) main.go
	@echo "Done: ./$(BINARY)"

build-linux: frontend
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o $(BINARY)-linux main.go
	@echo "Done: ./$(BINARY)-linux"

build-windows: frontend
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o $(BINARY)-windows.exe main.go
	@echo "Done: ./$(BINARY)-windows.exe"

clean:
	rm -f $(BINARY) $(BINARY)-linux $(BINARY)-windows.exe
	rm -rf $(FRONTEND_DIR)/dist
