import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serves this project under /Encounty/.
export default defineConfig({
  base: "/Encounty/",
  plugins: [tailwindcss()],
});
