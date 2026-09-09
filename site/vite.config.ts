import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

const LOCALES_DIR = resolve(__dirname, "src/locales");
const I18N_MODULE = resolve(__dirname, "src/i18n.js");

/** Reads every locale dictionary so the build can inline them into the page. */
function loadDictionaries(): Record<string, unknown> {
  return Object.fromEntries(
    readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(resolve(LOCALES_DIR, f), "utf8"))]),
  );
}

/**
 * Strips the ES module syntax off src/i18n.js so it can run as a classic
 * script. Only top-level `import` lines and leading `export` keywords are
 * removed; anything else left over means the module drifted from what this
 * transform can handle, so the build fails instead of shipping broken inline
 * JavaScript.
 */
function asClassicScript(source: string): string {
  const stripped = source.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, "");
  if (/^\s*(?:import|export)\s/m.test(stripped)) {
    throw new Error("inline-i18n: src/i18n.js has module syntax this transform cannot strip");
  }
  return stripped;
}

/**
 * Translates every page before its first paint.
 *
 * The page markup carries English fallback text for crawlers and for visitors
 * without JavaScript. A module script cannot replace that text before the
 * browser paints, since module scripts are always deferred and the bundle
 * still has to be fetched, which is what made the page flash English and then
 * switch. So the dictionaries and the i18n runtime are inlined into a
 * synchronous script at the end of <body>, and the body stays hidden until it
 * has run. The class doing the hiding is set from JavaScript, so a visitor
 * without JavaScript never hides anything and simply keeps the fallback text.
 */
function inlineI18nBootstrap(): Plugin {
  return {
    name: "encounty-inline-i18n",
    transformIndexHtml() {
      // Inlined into a <script>, so "</script>" inside a string would end the
      // element early. Escaping every "<" keeps the JSON valid and inert.
      const dicts = JSON.stringify(loadDictionaries()).replace(/</g, "\\u003c");
      const runtime = asClassicScript(readFileSync(I18N_MODULE, "utf8"));
      return {
        tags: [
          {
            tag: "script",
            injectTo: "head-prepend" as const,
            children: 'document.documentElement.classList.add("i18n-pending");',
          },
          {
            tag: "style",
            injectTo: "head-prepend" as const,
            children: ".i18n-pending body{visibility:hidden}",
          },
          {
            tag: "script",
            injectTo: "body" as const,
            children: `window.__ENCOUNTY_I18N__=${dicts};
(function(){
${runtime}
try { applyI18n(); } finally {
  document.documentElement.classList.remove("i18n-pending");
}
})();`,
          },
        ],
      };
    },
  };
}

// GitHub Pages serves this project under /Encounty/.
export default defineConfig({
  base: "/Encounty/",
  plugins: [tailwindcss(), inlineI18nBootstrap()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        update: resolve(__dirname, "update.html"),
        changelog: resolve(__dirname, "changelog.html"),
        testing: resolve(__dirname, "testing.html"),
      },
    },
  },
});
