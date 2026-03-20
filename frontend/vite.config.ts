import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ["tesseract.js"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err: Error) => {
            // ECONNRESET is expected on page reload (browser kills WebSocket)
            if ((err as Error & { code?: string }).code === "ECONNRESET") return;
            console.error("[ws proxy]", err);
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
    assetsInlineLimit: 0,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test-setup.ts",
        "src/test-utils.tsx",
        "src/main.tsx",
        "src/utils/test.ts",
        "src/types/index.ts",
        "src/contexts/CaptureServiceContext.tsx",
      ],
    },
  },
});
