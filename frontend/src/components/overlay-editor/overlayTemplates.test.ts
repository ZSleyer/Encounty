/**
 * overlayTemplates.test.ts enforces the contract stated at the top of
 * overlayTemplates.ts. A template is applied wholesale, so a template that is
 * internally inconsistent ships a broken overlay to whoever picks it, and no
 * amount of editor validation can catch it afterwards.
 *
 * The checks live in this file as plain functions over an OverlaySettings, and
 * every one of them is proven against a deliberately broken fixture before it
 * is pointed at the real templates. A check that cannot fail would assert
 * nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import de from "../../locales/de.json";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ja from "../../locales/ja.json";
import type { OverlayElementBase, OverlaySettings, TextStyle } from "../../types";
import { ENGINE_FONT_ALIASES, GOOGLE_FONTS } from "../../utils/fonts";
import { DRAGGABLE_ELEMENT_KEYS } from "../../utils/overlayElements";
import { buildTemplates, LABEL_KEYS, type Translate } from "./overlayTemplates";

// --- Fixtures ----------------------------------------------------------------

const LOCALES: Record<string, Record<string, string>> = { de, en, es, fr, ja };

/** Builds the translator the templates take, backed by one locale file. */
function translatorFor(locale: string): Translate {
  const table = LOCALES[locale];
  return (key) => table[key] ?? key;
}

const englishTemplates = buildTemplates(translatorFor("en"));

/**
 * Fields the overlay format used to carry and no longer does. A template that
 * still sets one of them was written against an older schema, and the field
 * would sit in every overlay applied from it forever.
 */
const REMOVED_FIELDS = [
  "trigger_exit",
  "text_shadow_color_type",
  "text_shadow_gradient_stops",
  "text_shadow_gradient_angle",
];

/** Families a template may use: the engine aliases plus the curated Google list. */
const ALLOWED_FONTS = new Set<string>([...ENGINE_FONT_ALIASES, ...GOOGLE_FONTS]);

// --- Checks ------------------------------------------------------------------

/** Reads one positioned element out of a settings object, if it exists. */
function elementOf(settings: OverlaySettings, key: string): OverlayElementBase | undefined {
  return (settings as unknown as Record<string, OverlayElementBase | undefined>)[key];
}

/** Names every element key the settings object does not carry. */
function missingElements(settings: OverlaySettings): string[] {
  return DRAGGABLE_ELEMENT_KEYS.filter((key) => !elementOf(settings, key));
}

/** Names every element whose box pokes outside its own canvas. */
function elementsOutsideCanvas(settings: OverlaySettings): string[] {
  return DRAGGABLE_ELEMENT_KEYS.filter((key) => {
    const el = elementOf(settings, key);
    if (!el) return false;
    return (
      el.x < 0 ||
      el.y < 0 ||
      el.x + el.width > settings.canvas_width ||
      el.y + el.height > settings.canvas_height
    );
  });
}

/** True when two boxes share at least one pixel. Touching edges do not count. */
function boxesOverlap(a: OverlayElementBase, b: OverlayElementBase): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/** Names every pair of visible elements that share pixels, as "a/b". */
function overlappingVisiblePairs(settings: OverlaySettings): string[] {
  const visible = DRAGGABLE_ELEMENT_KEYS.flatMap((key) => {
    const el = elementOf(settings, key);
    return el?.visible ? [{ key, el }] : [];
  });
  const pairs: string[] = [];
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      if (boxesOverlap(visible[i].el, visible[j].el)) {
        pairs.push(`${visible[i].key}/${visible[j].key}`);
      }
    }
  }
  return pairs;
}

/** Walks the whole settings tree and names every removed field it still sets. */
function usedRemovedFields(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(usedRemovedFields);
  if (value === null || typeof value !== "object") return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (REMOVED_FIELDS.includes(key)) found.push(key);
    found.push(...usedRemovedFields(child));
  }
  return found;
}

/**
 * Collects every text style in the settings tree. A style is recognised by its
 * font_family, which is the one field all of them carry.
 */
function collectStyles(value: unknown): TextStyle[] {
  if (Array.isArray(value)) return value.flatMap(collectStyles);
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const here = typeof record.font_family === "string" ? [value as TextStyle] : [];
  return [...here, ...Object.values(record).flatMap(collectStyles)];
}

/** Names every font family that is neither an engine alias nor a curated Google one. */
function uncuratedFonts(settings: OverlaySettings): string[] {
  return collectStyles(settings)
    .map((style) => style.font_family)
    .filter((family) => !ALLOWED_FONTS.has(family));
}

/** Names every element that ships a non-empty prefix or suffix. */
function elementsWithAffixes(settings: OverlaySettings): string[] {
  return DRAGGABLE_ELEMENT_KEYS.filter((key) => {
    const el = elementOf(settings, key) as
      | (OverlayElementBase & { prefix_text?: string; suffix_text?: string })
      | undefined;
    if (!el) return false;
    return Boolean(el.prefix_text) || Boolean(el.suffix_text);
  });
}

// --- The checks catch a broken template --------------------------------------

/** A known-good template to mutate into the broken fixtures below. */
function goodSettings(): OverlaySettings {
  return structuredClone(englishTemplates[0].settings);
}

describe("template checks", () => {
  it("reports an element the template forgot", () => {
    const broken = goodSettings() as unknown as Record<string, unknown>;
    delete broken.total_timer;
    expect(missingElements(broken as unknown as OverlaySettings)).toEqual(["total_timer"]);
  });

  it("reports an element hanging off the canvas", () => {
    const broken = goodSettings();
    broken.timer.x = broken.canvas_width - 10;
    expect(elementsOutsideCanvas(broken)).toEqual(["timer"]);
  });

  it("reports an element with a negative coordinate", () => {
    const broken = goodSettings();
    broken.sprite.y = -1;
    expect(elementsOutsideCanvas(broken)).toEqual(["sprite"]);
  });

  it("reports two visible elements sitting on top of each other", () => {
    const broken = goodSettings();
    broken.timer.x = broken.counter.x;
    broken.timer.y = broken.counter.y;
    expect(overlappingVisiblePairs(broken)).toContain("counter/timer");
  });

  it("ignores an overlap that only involves a hidden element", () => {
    const broken = goodSettings();
    broken.phase!.x = broken.counter.x;
    broken.phase!.y = broken.counter.y;
    expect(broken.phase!.visible).toBe(false);
    expect(overlappingVisiblePairs(broken)).toEqual([]);
  });

  it("reports a removed field anywhere in the tree", () => {
    const broken = goodSettings() as unknown as Record<string, unknown>;
    (broken.counter as Record<string, unknown>).trigger_exit = "fade-out";
    (
      (broken.name as Record<string, unknown>).style as Record<string, unknown>
    ).text_shadow_gradient_angle = 90;
    expect(usedRemovedFields(broken).sort()).toEqual([
      "text_shadow_gradient_angle",
      "trigger_exit",
    ]);
  });

  it("reports a font that is only installed on the author's machine", () => {
    const broken = goodSettings();
    broken.counter.style.font_family = "Comic Sans MS";
    expect(uncuratedFonts(broken)).toEqual(["Comic Sans MS"]);
  });

  it("reports a default prefix or suffix", () => {
    const broken = goodSettings();
    broken.counter.prefix_text = "x";
    broken.odds.suffix_text = "!";
    expect(elementsWithAffixes(broken).sort()).toEqual(["counter", "odds"]);
  });
});

// --- The real templates pass -------------------------------------------------

describe("overlay templates", () => {
  it("offers the default first, followed by four alternatives", () => {
    expect(englishTemplates.map((tpl) => tpl.id)).toEqual([
      "default",
      "minimal",
      "retro",
      "sidebar",
      "phase",
    ]);
  });

  it("gives every template a distinct canvas", () => {
    const sizes = englishTemplates.map(
      (tpl) => `${tpl.settings.canvas_width}x${tpl.settings.canvas_height}`,
    );
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  for (const template of englishTemplates) {
    describe(template.id, () => {
      const { settings } = template;

      it("carries all nine elements", () => {
        expect(missingElements(settings)).toEqual([]);
      });

      it("keeps every element inside its canvas", () => {
        expect(elementsOutsideCanvas(settings)).toEqual([]);
      });

      it("keeps visible elements apart", () => {
        expect(overlappingVisiblePairs(settings)).toEqual([]);
      });

      it("sets no removed field", () => {
        expect(usedRemovedFields(settings)).toEqual([]);
      });

      it("uses only engine aliases and curated Google families", () => {
        expect(uncuratedFonts(settings)).toEqual([]);
      });

      it("ships no prefix and no suffix", () => {
        expect(elementsWithAffixes(settings)).toEqual([]);
      });

      it("shows the sprite and the counter at minimum", () => {
        expect(settings.sprite.visible).toBe(true);
        expect(settings.counter.visible).toBe(true);
      });
    });
  }

  it("puts a gradient outline and a gradient fill on offer", () => {
    const styles = englishTemplates.flatMap((tpl) => collectStyles(tpl.settings));
    expect(styles.some((style) => style.outline_type === "gradient")).toBe(true);
    expect(styles.some((style) => style.color_type === "gradient")).toBe(true);
  });

  it("makes the phase template show phase, total counter and total timer", () => {
    const phase = englishTemplates.find((tpl) => tpl.id === "phase")!.settings;
    expect(phase.phase!.visible).toBe(true);
    expect(phase.total_counter!.visible).toBe(true);
    expect(phase.total_timer!.visible).toBe(true);
  });

  it("keeps the minimal template down to the sprite and the counter", () => {
    const minimal = englishTemplates.find((tpl) => tpl.id === "minimal")!.settings;
    const visible = DRAGGABLE_ELEMENT_KEYS.filter((key) => elementOf(minimal, key)?.visible);
    expect(visible).toEqual(["sprite", "counter"]);
  });
});

// --- Translated captions -----------------------------------------------------

describe("template i18n", () => {
  const templateKeys = englishTemplates.flatMap((tpl) => [tpl.nameKey, tpl.descriptionKey]);
  const uiKeys = [
    "overlay.templatesTitle",
    "overlay.templateApply",
    "overlay.templateConfirmTitle",
    "overlay.templateConfirmMessage",
  ];
  const allKeys = [...templateKeys, ...uiKeys, ...Object.values(LABEL_KEYS)];

  for (const [locale, table] of Object.entries(LOCALES)) {
    it(`${locale} translates every template key`, () => {
      const missing = allKeys.filter((key) => !(key in table) || table[key].trim() === "");
      expect(missing).toEqual([]);
    });

    it(`${locale} bakes its own captions into every template`, () => {
      const built = buildTemplates(translatorFor(locale));
      const captions = built.flatMap((tpl) =>
        DRAGGABLE_ELEMENT_KEYS.map(
          (key) =>
            (elementOf(tpl.settings, key) as { label_text?: string } | undefined)?.label_text,
        ),
      );
      // A caption equal to its own key means the lookup fell through, which is
      // exactly the bug that showed raw keys in the layer panel.
      const unresolved = captions.filter((caption) => caption?.startsWith("overlay."));
      expect(unresolved).toEqual([]);
    });
  }

  it("gives the German user German captions, not English ones", () => {
    const german = buildTemplates(translatorFor("de"))[0].settings;
    expect(german.timer.label_text).toBe("ZEIT");
    expect(german.counter.label_text).toBe("ENCOUNTER");
    // The community loan word stays English on purpose.
    expect(german.odds.label_text).toBe("ODDS");
  });

  /**
   * The Go backend seeds the very same default layout on first run and has no
   * translator, so it carries its own copy of the six captions. Two copies of
   * the same strings drift, and the drift would only show up as a German user
   * getting an English overlay on a fresh install, which nobody reports. So the
   * Go table is parsed straight out of the source and diffed against the locale
   * files. The captions are listed there in the field order of overlayLabelSet.
   */
  it("keeps the Go label table in step with the locale files", () => {
    // import.meta.url is an http URL under Vite, so the path is resolved from
    // the working directory instead: vitest runs in frontend/, the sibling of
    // backend/, but a run from the repo root has to find it too.
    const candidates = ["../backend/internal/state/state.go", "backend/internal/state/state.go"];
    const statePath = candidates.map((rel) => resolve(process.cwd(), rel)).find(existsSync);
    expect(statePath, `state.go not found, tried ${candidates.join(" and ")}`).toBeDefined();
    const source = readFileSync(statePath!, "utf8");
    const table = /var overlayLabels = map\[string\]overlayLabelSet\{([\s\S]*?)\n\}/.exec(source);
    expect(table, "overlayLabels table not found in state.go").not.toBeNull();

    const localeKeys = [
      LABEL_KEYS.encounters,
      LABEL_KEYS.time,
      LABEL_KEYS.odds,
      LABEL_KEYS.phase,
      LABEL_KEYS.totalEncounters,
      LABEL_KEYS.totalTime,
    ];
    const rows = [...table![1].matchAll(/"(\w+)":\s*\{([^}]*)\}/g)];
    expect(rows.map((row) => row[1]).sort()).toEqual(["de", "en", "es", "fr", "ja"]);

    for (const [, locale, values] of rows) {
      const captions = [...values.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
      expect(captions, `${locale} row of overlayLabels`).toEqual(
        localeKeys.map((key) => LOCALES[locale][key]),
      );
    }
  });

  it("keeps all five locales at the same key count", () => {
    const counts = Object.entries(LOCALES).map(([locale, table]) => [
      locale,
      Object.keys(table).length,
    ]);
    const reference = Object.keys(LOCALES.de).length;
    expect(counts).toEqual(Object.keys(LOCALES).map((locale) => [locale, reference]));
  });
});
