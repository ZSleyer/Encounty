import { describe, it, expect } from "vitest";
import translations, { t, LOCALES, Locale } from "./i18n";

describe("i18n", () => {
  // --- t() translation lookup ---

  describe("t()", () => {
    it("returns the correct German translation for a known key", () => {
      expect(t("de", "nav.dashboard")).toBe("Dashboard");
      expect(t("de", "dash.encounters")).toBe("Begegnungen");
    });

    it("returns the correct English translation for a known key", () => {
      expect(t("en", "nav.dashboard")).toBe("Dashboard");
      expect(t("en", "dash.encounters")).toBe("Encounters");
    });

    it("returns the key itself for missing translations", () => {
      expect(t("de", "nonexistent.key")).toBe("nonexistent.key");
      expect(t("en", "also.missing")).toBe("also.missing");
    });
  });

  // --- Translation completeness ---

  describe("completeness", () => {
    const deKeys = Object.keys(translations.de).sort();
    const enKeys = Object.keys(translations.en).sort();

    it("has the same keys in both languages", () => {
      const missingInEn = deKeys.filter((k) => !(k in translations.en));
      const missingInDe = enKeys.filter((k) => !(k in translations.de));

      expect(missingInEn).toEqual([]);
      expect(missingInDe).toEqual([]);
    });

    it("has no empty translation values", () => {
      for (const locale of ["de", "en"] as Locale[]) {
        const empty = Object.entries(translations[locale])
          .filter(([, v]) => v.trim() === "")
          .map(([k]) => k);
        expect(empty).toEqual([]);
      }
    });
  });

  // --- LOCALES array ---

  describe("LOCALES", () => {
    it("contains German and English entries", () => {
      const codes = LOCALES.map((l) => l.code);
      expect(codes).toContain("de");
      expect(codes).toContain("en");
    });

    it("each entry has a code, label, and flag", () => {
      for (const locale of LOCALES) {
        expect(locale.code).toBeTruthy();
        expect(locale.label).toBeTruthy();
        expect(locale.flag).toBeTruthy();
      }
    });
  });
});
