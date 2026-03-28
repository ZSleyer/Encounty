import { describe, it, expect } from "vitest";
import de from "../locales/de.json";
import en from "../locales/en.json";
import fr from "../locales/fr.json";
import es from "../locales/es.json";
import ja from "../locales/ja.json";
import { LOCALES } from "./i18n";

const allTranslations: Record<string, Record<string, string>> = { de, en, fr, es, ja };
const referenceLocale = "de";
const referenceKeys = Object.keys(allTranslations[referenceLocale]).sort((a, b) => a.localeCompare(b));

describe("i18n", () => {
  // --- Translation completeness ---

  describe("completeness", () => {
    for (const code of Object.keys(allTranslations)) {
      if (code === referenceLocale) continue;

      it(`${code} has the same keys as ${referenceLocale}`, () => {
        const missing = referenceKeys.filter((k) => !(k in allTranslations[code]));
        const extra = Object.keys(allTranslations[code]).filter((k) => !(k in allTranslations[referenceLocale]));
        expect(missing, `Missing in ${code}`).toEqual([]);
        expect(extra, `Extra in ${code}`).toEqual([]);
      });
    }

    for (const [code, translations] of Object.entries(allTranslations)) {
      it(`${code} has no empty translation values`, () => {
        const empty = Object.entries(translations)
          .filter(([, v]) => v.trim() === "")
          .map(([k]) => k);
        expect(empty).toEqual([]);
      });
    }
  });

  // --- LOCALES array ---

  describe("LOCALES", () => {
    it("contains all supported locales", () => {
      const codes = LOCALES.map((l) => l.code);
      expect(codes).toContain("de");
      expect(codes).toContain("en");
      expect(codes).toContain("fr");
      expect(codes).toContain("es");
      expect(codes).toContain("ja");
    });

    it("each entry has a code, label, and flag", () => {
      for (const locale of LOCALES) {
        expect(locale.code).toBeTruthy();
        expect(locale.label).toBeTruthy();
        expect(locale.flag).toBeTruthy();
      }
    });

    it("matches the number of translation files", () => {
      const localeCodes = LOCALES.map((l) => l.code);
      const translationCodes = Object.keys(allTranslations);
      expect([...localeCodes].sort((a, b) => a.localeCompare(b))).toEqual([...translationCodes].sort((a, b) => a.localeCompare(b)));
    });
  });
});
