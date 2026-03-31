import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { createReadStream, existsSync } from "node:fs";

/** Backend port — must match backend/internal/server/port.go DefaultPort. */
const BACKEND_PORT = 8192;

/** Dev-only plugin: serves test fixture files at /test-fixtures/. */
function serveTestFixtures(): Plugin {
  const fixturesDir = resolve(__dirname, "src/engine/__tests__/fixtures");
  const mimeTypes: Record<string, string> = {
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".json": "application/json",
  };
  return {
    name: "serve-test-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/test-fixtures", (req, res, next) => {
        const filePath = resolve(fixturesDir, (req.url ?? "").replace(/^\//, ""));
        if (!filePath.startsWith(fixturesDir) || !existsSync(filePath)) return next();
        const ext = filePath.slice(filePath.lastIndexOf("."));
        if (mimeTypes[ext]) res.setHeader("Content-Type", mimeTypes[ext]);
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), serveTestFixtures()],
  optimizeDeps: {
    include: ["tesseract.js"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${BACKEND_PORT}`,
      "/ws": {
        target: `ws://localhost:${BACKEND_PORT}`,
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
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test-setup.ts",
        "src/test-utils.tsx",
        "src/main.tsx",
        "src/utils/test.ts",
        "src/types/**",
        "src/contexts/CaptureServiceContext.tsx",
        "src/engine/WebGPUDetector.ts",
        "src/engine/WorkerDetector.ts",
        "src/engine/CPUDetector.ts",
        "src/engine/detection.worker.ts",
        "src/engine/shaders/**",
        "src/engine/index.ts",
        "src/components/settings/MacPermissions.tsx",
        "src/components/detector/GpuEquivalenceTest.tsx",
        "src/utils/i18n.ts",
      ],
    },
  },
});
