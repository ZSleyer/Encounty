import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
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
          proxy.on("error", (err) => {
            // ECONNRESET is expected on page reload (browser kills WebSocket)
            if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
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
});
