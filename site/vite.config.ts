import { resolve } from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serves this project under /Encounty/.
export default defineConfig({
  base: "/Encounty/",
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        update: resolve(__dirname, "update.html"),
        changelog: resolve(__dirname, "changelog.html"),
      },
    },
  },
});
