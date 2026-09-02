/**
 * detectorPanelHelpers.ts -- Pure helpers and constants of the detector panel.
 *
 * Holds the panel's default detector config, the status-dot and status-label
 * mapping, the settings-draft seed and the OCR language tables.
 */
import { DetectorConfig, DetectorTemplate } from "../../types";
import {
  DEFAULT_PRECISION,
  DEFAULT_HYSTERESIS_FACTOR,
  DEFAULT_CONSECUTIVE_HITS,
  DEFAULT_COOLDOWN_SEC,
  DEFAULT_POLL_MS,
  MIN_POLL_MS,
  MAX_POLL_MS,
} from "../../engine/detectorDefaults";
import { type TemplateSettingsPatch } from "./DetectorSettings";

/** Detector config a pokemon starts from when it has none stored yet. */
export const DEFAULT_CONFIG: DetectorConfig = {
  enabled: false,
  source_type: "browser_display",
  region: { x: 0, y: 0, w: 0, h: 0 },
  window_title: "",
  templates: [],
  change_threshold: 0.15,
};

/** Derive a user-facing error message from a caught exception. */
export function getErrorMessage(err: unknown, networkMsg: string, fallbackMsg: string): string {
  if (err instanceof TypeError) return networkMsg;
  if (err instanceof Error) return err.message;
  return fallbackMsg;
}

/** Seed a full settings draft from a template, falling back to hardcoded defaults for unset fields. */
export function draftFromTemplate(tmpl: DetectorTemplate | null): Required<TemplateSettingsPatch> {
  return {
    precision: tmpl?.precision ?? DEFAULT_PRECISION,
    hysteresis_factor: tmpl?.hysteresis_factor ?? DEFAULT_HYSTERESIS_FACTOR,
    hysteresis_mode: tmpl?.hysteresis_mode ?? "score",
    consecutive_hits: tmpl?.consecutive_hits ?? DEFAULT_CONSECUTIVE_HITS,
    cooldown_sec: tmpl?.cooldown_sec ?? DEFAULT_COOLDOWN_SEC,
    poll_interval_ms: tmpl?.poll_interval_ms ?? DEFAULT_POLL_MS,
    min_poll_ms: tmpl?.min_poll_ms ?? MIN_POLL_MS,
    max_poll_ms: tmpl?.max_poll_ms ?? MAX_POLL_MS,
  };
}

/** Status-dot classes and pulse flag for the current detector state. */
export function stateDotClass(state: string, running: boolean): { dot: string; pulse: boolean } {
  if (!running) return { dot: "bg-text-muted", pulse: false };
  // Palette mirrors the TemplateEditor sparkline so users see the same colors
  // for the same detection states across the live detector and the preview.
  switch (state) {
    case "match":
      return { dot: "bg-accent-green", pulse: false };
    case "cooldown":
      return { dot: "bg-accent-purple", pulse: false };
    default:
      return { dot: "bg-accent-blue", pulse: true };
  }
}

/** Localized status label for the current detector state. */
export function stateLabel(state: string, running: boolean, t: (k: string) => string): string {
  if (!running) return "\u2013";
  switch (state) {
    case "match":
      return t("detector.stateMatch");
    case "cooldown":
      return t("detector.stateCooldown");
    default:
      return t("detector.stateIdle");
  }
}

/** Map ISO 639-1 (pokemon language) to tesseract language code. */
export const LANG_MAP: Record<string, string> = {
  de: "deu",
  fr: "fra",
  es: "spa",
  it: "ita",
  ja: "jpn",
  ko: "kor",
  "zh-hans": "chi_sim",
  "zh-hant": "chi_sim",
};

/**
 * Map the user's interface locale to the tesseract language code that should
 * be preloaded so the first OCR run does not pay worker init latency. We
 * always also preload `eng` as a universal fallback.
 */
export const INTERFACE_LOCALE_TO_TESSERACT: Record<string, string> = {
  de: "deu",
  en: "eng",
  es: "spa",
  fr: "fra",
  ja: "jpn",
};

/** PATCH with a single retry on network failure (TypeError). */
export const patchWithRetry = async (url: string, body: unknown): Promise<Response> => {
  try {
    return await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Network error, retry once after 500ms
    await new Promise((r) => setTimeout(r, 500));
    return fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
};
