import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve, basename } from "node:path";
import { createReadStream, existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";

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

/**
 * Tesseract.js languages whose traineddata files are bundled into the app.
 *
 * Keep this in sync with `BUNDLED_OCR_LANGS` in `src/hooks/useOCR.ts`.
 * Other tesseract languages still work — they fall back to the default CDN
 * (configured per-worker in useOCR).
 */
const BUNDLED_TRAINEDDATA = ["eng", "deu", "spa", "fra", "jpn"] as const;

/** Resolve the on-disk path of a bundled traineddata.gz inside node_modules. */
function traineddataPath(lang: string): string {
  return resolve(
    __dirname,
    `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
  );
}

/** Resolve a /tessdata/<lang>.traineddata.gz request to an absolute path. */
function resolveTraineddata(name: string): string | null {
  const match = /^([a-z_]+)\.traineddata\.gz$/i.exec(name);
  if (!match) return null;
  const lang = match[1];
  if (!(BUNDLED_TRAINEDDATA as readonly string[]).includes(lang)) return null;
  const candidate = traineddataPath(lang);
  return existsSync(candidate) ? candidate : null;
}

/**
 * Bundles tesseract.js worker, core, and selected language data into the app
 * so OCR works without network access. Without this, tesseract.js fetches
 * worker.min.js, tesseract-core*.wasm, and *.traineddata.gz from public CDNs
 * at runtime, which fails for users behind firewalls/DNS filters and produces
 * a confusing "Failed to execute 'importScripts' on WorkerGlobalScope" error.
 *
 * In dev: serves /tesseract/* and /tessdata/* from node_modules via middleware.
 * In build: copies the same files into dist/tesseract/ and dist/tessdata/.
 */
function bundleTesseractAssets(): Plugin {
  const workerSrc = resolve(__dirname, "node_modules/tesseract.js/dist/worker.min.js");
  const coreDir = resolve(__dirname, "node_modules/tesseract.js-core");

  /** Resolve a /tesseract/<file> request to an absolute path on disk. */
  function resolveCoreAsset(name: string): string | null {
    if (name === "worker.min.js") return existsSync(workerSrc) ? workerSrc : null;
    // Only allow plain file names (no traversal) and only files that exist in core dir.
    if (name.includes("/") || name.includes("..")) return null;
    const candidate = resolve(coreDir, name);
    return existsSync(candidate) ? candidate : null;
  }

  return {
    name: "bundle-tesseract-assets",
    configureServer(server) {
      server.middlewares.use("/tesseract", (req, res, next) => {
        const name = basename((req.url ?? "").split("?")[0].replace(/^\//, ""));
        const filePath = resolveCoreAsset(name);
        if (!filePath) return next();
        if (filePath.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        else if (filePath.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
        createReadStream(filePath).pipe(res);
      });
      server.middlewares.use("/tessdata", (req, res) => {
        const name = basename((req.url ?? "").split("?")[0].replace(/^\//, ""));
        const filePath = resolveTraineddata(name);
        if (!filePath) {
          // Return a real 404 for unbundled languages so tesseract.js sees a
          // proper failure rather than the SPA index.html that Vite would
          // otherwise serve from its catch-all middleware.
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/gzip");
        res.setHeader("Content-Encoding", "identity"); // Prevent dev server from re-gzipping
        createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      const coreOut = resolve(__dirname, "dist/tesseract");
      mkdirSync(coreOut, { recursive: true });
      if (existsSync(workerSrc)) copyFileSync(workerSrc, resolve(coreOut, "worker.min.js"));
      if (existsSync(coreDir)) {
        for (const entry of readdirSync(coreDir)) {
          if (entry.startsWith("tesseract-core") && (entry.endsWith(".js") || entry.endsWith(".wasm"))) {
            copyFileSync(resolve(coreDir, entry), resolve(coreOut, entry));
          }
        }
      }
      const langOut = resolve(__dirname, "dist/tessdata");
      mkdirSync(langOut, { recursive: true });
      for (const lang of BUNDLED_TRAINEDDATA) {
        const src = traineddataPath(lang);
        if (existsSync(src)) copyFileSync(src, resolve(langOut, `${lang}.traineddata.gz`));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), serveTestFixtures(), bundleTesseractAssets()],
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
    exclude: ["**/node_modules/**", "src/engine/__tests__/**"],
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
        "src/locales/index.ts",
        "src/components/backgrounds/**",
      ],
    },
  },
});
