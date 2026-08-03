import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ENGINE_FONT_ALIASES,
  GOOGLE_FONTS,
  dedupeFontFamilies,
  isEngineFontAlias,
  isGoogleFont,
  queryLocalFontFamilies,
  supportsLocalFonts,
} from "./fonts";

/** Installs a fake Local Font Access API on the global object. */
function stubQueryLocalFonts(impl: () => Promise<unknown>) {
  Object.defineProperty(globalThis, "queryLocalFonts", {
    value: impl,
    writable: true,
    configurable: true,
  });
}

function removeQueryLocalFonts() {
  Reflect.deleteProperty(globalThis, "queryLocalFonts");
}

describe("fonts", () => {
  afterEach(() => {
    removeQueryLocalFonts();
  });

  // --- Curated lists ---

  describe("isGoogleFont", () => {
    it("accepts every curated Google family", () => {
      for (const family of GOOGLE_FONTS) {
        expect(isGoogleFont(family)).toBe(true);
      }
    });

    it("rejects locally installed families", () => {
      expect(isGoogleFont("Comic Sans MS")).toBe(false);
      expect(isGoogleFont("Segoe UI")).toBe(false);
      expect(isGoogleFont("DejaVu Sans")).toBe(false);
    });

    it("rejects the engine aliases", () => {
      for (const alias of ENGINE_FONT_ALIASES) {
        expect(isGoogleFont(alias)).toBe(false);
      }
    });

    it("is case sensitive and rejects the empty family", () => {
      expect(isGoogleFont("roboto")).toBe(false);
      expect(isGoogleFont("")).toBe(false);
    });
  });

  describe("isEngineFontAlias", () => {
    it("accepts the four aliases and nothing else", () => {
      expect(ENGINE_FONT_ALIASES.every(isEngineFontAlias)).toBe(true);
      expect(isEngineFontAlias("Roboto")).toBe(false);
      expect(isEngineFontAlias("")).toBe(false);
    });
  });

  // --- Deduplication ---

  describe("dedupeFontFamilies", () => {
    it("collapses the per-style entries into unique families", () => {
      const families = dedupeFontFamilies([
        { family: "Fira Sans" },
        { family: "Fira Sans" },
        { family: "Fira Sans" },
        { family: "Arial" },
      ]);
      expect(families).toEqual(["Arial", "Fira Sans"]);
    });

    it("sorts alphabetically", () => {
      const families = dedupeFontFamilies([
        { family: "Zapfino" },
        { family: "Arial" },
        { family: "Menlo" },
      ]);
      expect(families).toEqual(["Arial", "Menlo", "Zapfino"]);
    });

    it("trims and drops blank families", () => {
      const families = dedupeFontFamilies([
        { family: "  Arial  " },
        { family: "Arial" },
        { family: "   " },
        { family: "" },
      ]);
      expect(families).toEqual(["Arial"]);
    });

    it("returns an empty list for an empty query result", () => {
      expect(dedupeFontFamilies([])).toEqual([]);
    });
  });

  // --- Feature detection and degradation ---

  describe("supportsLocalFonts", () => {
    it("is false when queryLocalFonts is undefined (jsdom, Firefox, OBS)", () => {
      expect(supportsLocalFonts()).toBe(false);
    });

    it("is true once the API exists", () => {
      stubQueryLocalFonts(() => Promise.resolve([]));
      expect(supportsLocalFonts()).toBe(true);
    });
  });

  describe("queryLocalFontFamilies", () => {
    it("reports unsupported when the API is missing", async () => {
      await expect(queryLocalFontFamilies()).resolves.toEqual({ status: "unsupported" });
    });

    it("reports denied when the permission is refused", async () => {
      stubQueryLocalFonts(() => Promise.reject(new Error("denied")));
      await expect(queryLocalFontFamilies()).resolves.toEqual({ status: "denied" });
    });

    it("returns the deduplicated families on success", async () => {
      stubQueryLocalFonts(() =>
        Promise.resolve([
          { family: "Inter", style: "Regular" },
          { family: "Inter", style: "Bold" },
          { family: "Arial", style: "Regular" },
        ]),
      );
      await expect(queryLocalFontFamilies()).resolves.toEqual({
        status: "ok",
        families: ["Arial", "Inter"],
      });
    });

    it("survives a query that resolves without a list", async () => {
      const query = vi.fn(() => Promise.resolve(undefined));
      stubQueryLocalFonts(query);
      await expect(queryLocalFontFamilies()).resolves.toEqual({ status: "ok", families: [] });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
