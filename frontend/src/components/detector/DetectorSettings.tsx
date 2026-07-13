/**
 * DetectorSettings.tsx — Advanced detector configuration panel.
 *
 * Collapsible section with threshold/precision sliders, polling interval
 * configuration (base, min, max poll), cooldown and consecutive hits settings,
 * and hunt-type preset integration. All of these are the active template's
 * own settings (see DetectorTemplate); there is no hunt-level default anymore.
 */
import { useState } from "react";
import { ChevronDown, Settings, Save } from "lucide-react";
import { DetectorTemplate, HuntTypePreset } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import {
  DEFAULT_PRECISION, DEFAULT_HYSTERESIS_FACTOR, DEFAULT_CONSECUTIVE_HITS,
  DEFAULT_COOLDOWN_SEC, DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS,
} from "../../engine/detectorDefaults";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Result of validating the three adaptive-polling intervals against each other. */
export type PollIntervalErrors = Readonly<{
  base?: string;
  min?: string;
  max?: string;
}>;

/**
 * Validates that `min ≤ base ≤ max` and returns per-field error message keys.
 * The keys are i18n keys; the caller is responsible for translating them.
 * Returns an empty object when all three values are consistent.
 */
export function validatePollIntervals(
  base: number,
  min: number,
  max: number,
): PollIntervalErrors {
  const errors: { base?: string; min?: string; max?: string } = {};
  if (min > max) {
    errors.min = "detector.errPollMinGtMax";
    errors.max = "detector.errPollMaxLtMin";
  }
  if (base < min) {
    errors.base = "detector.errPollBaseLtMin";
  } else if (base > max) {
    errors.base = "detector.errPollBaseGtMax";
  }
  return errors;
}

/** The subset of DetectorTemplate fields this panel edits. */
export type TemplateSettingsPatch = Partial<Pick<DetectorTemplate,
  "precision" | "hysteresis_factor" | "hysteresis_mode" | "cooldown_sec" | "consecutive_hits" |
  "poll_interval_ms" | "min_poll_ms" | "max_poll_ms"
>>;

// ── Props ────────────────────────────────────────────────────────────────────

export type DetectorSettingsProps = Readonly<{
  /** The active (enabled) template whose settings are shown/edited, or null if none. */
  template: DetectorTemplate | null;
  onUpdate: (patch: TemplateSettingsPatch) => void;
  onSave: () => void;
  onReset: () => void;
  settingsDirty: boolean;
  activePreset?: HuntTypePreset;
  onApplyDefaults?: () => void;
  embedded?: boolean;
  disabled?: boolean;
}>;

// ── Component ────────────────────────────────────────────────────────────────

export function DetectorSettings({
  template,
  onUpdate,
  onSave,
  onReset,
  settingsDirty,
  activePreset,
  onApplyDefaults,
  embedded,
  disabled,
}: DetectorSettingsProps) {
  const { t } = useI18n();
  const [showSettings, setShowSettings] = useState(false);

  const precision = template?.precision ?? DEFAULT_PRECISION;
  const hysteresisFactor = template?.hysteresis_factor ?? DEFAULT_HYSTERESIS_FACTOR;
  const cooldownSec = template?.cooldown_sec ?? DEFAULT_COOLDOWN_SEC;
  const consecutiveHits = template?.consecutive_hits ?? DEFAULT_CONSECUTIVE_HITS;
  const pollIntervalMs = template?.poll_interval_ms ?? DEFAULT_POLL_MS;
  const minPollMs = template?.min_poll_ms ?? MIN_POLL_MS;
  const maxPollMs = template?.max_poll_ms ?? MAX_POLL_MS;

  const pollErrors = validatePollIntervals(pollIntervalMs, minPollMs, maxPollMs);
  const hasPollErrors = Boolean(pollErrors.base || pollErrors.min || pollErrors.max);

  /** No active template to edit — shown instead of the sliders. */
  const emptyState = (
    <div className={embedded ? "" : "px-4 pb-4 border-t border-border-subtle pt-3"}>
      <p className="text-[11px] leading-relaxed text-text-muted bg-bg-primary rounded-none px-3 py-2 border border-border-subtle">
        {t("detector.noActiveTemplate")}
      </p>
    </div>
  );

  /** The shared settings content rendered in both embedded and collapsible modes. */
  const settingsContent = (
    <div className={`${embedded ? "space-y-3" : "px-4 pb-4 space-y-3 border-t border-border-subtle pt-3"} ${disabled ? "opacity-50 pointer-events-none" : ""}`} aria-disabled={disabled || undefined}>
          {/* Header naming the template these settings belong to, so it's
              unambiguous which template is being edited. */}
          <p className="text-[11px] leading-relaxed text-text-muted bg-bg-primary rounded-none px-3 py-2 border border-border-subtle">
            {t("detector.templateSettingsNote", { name: template?.name || t("detector.unnamedTemplate") })}
          </p>

          {/* Precision slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="det-precision" className="text-xs 2xl:text-sm text-text-muted">{t("detector.precision")}</label>
              <span className="text-xs 2xl:text-sm text-text-secondary font-mono">{(precision * 100).toFixed(0)}%</span>
            </div>
            <input
              id="det-precision" type="range" min={0.5} max={1} step={0.01}
              value={precision}
              onChange={(e) => onUpdate({ precision: Number.parseFloat(e.target.value) })}
              className="w-full accent-accent-blue"
            />
            <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.precisionDesc")}</p>
          </div>

          {/* Grid: cooldown + hits */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="det-cooldown" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.cooldown")}</label>
              <input
                id="det-cooldown" type="number" min={0} max={120} value={cooldownSec}
                onChange={(e) => onUpdate({ cooldown_sec: Number.parseInt(e.target.value, 10) || 0 })}
                className="w-full bg-bg-primary border border-border-subtle rounded-none px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue/50"
              />
              <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.cooldownDesc")}</p>
            </div>
            <div>
              <label htmlFor="det-hits" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.hits")}</label>
              <input
                id="det-hits" type="number" min={1} max={10} value={consecutiveHits}
                onChange={(e) => onUpdate({ consecutive_hits: Number.parseInt(e.target.value, 10) || 1 })}
                className="w-full bg-bg-primary border border-border-subtle rounded-none px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue/50"
              />
              <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.hitsDesc")}</p>
            </div>
          </div>
          {/* Hysteresis factor slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="det-hysteresis" className="text-xs 2xl:text-sm text-text-muted">{t("detector.hysteresis")}</label>
              <span className="text-xs 2xl:text-sm text-text-secondary font-mono">{(hysteresisFactor * 100).toFixed(0)}%</span>
            </div>
            <input
              id="det-hysteresis" type="range" min={0.5} max={0.95} step={0.05}
              value={hysteresisFactor}
              onChange={(e) => onUpdate({ hysteresis_factor: Number.parseFloat(e.target.value) })}
              className="w-full accent-accent-blue"
            />
            <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.hysteresisDesc")}</p>
          </div>
          {/* Hysteresis mode toggle: region-based re-arm for 3D games where the
              score never drops because the whole screen moves constantly. */}
          <div>
            <div className="flex items-center gap-2">
              <input
                id="det-hysteresis-mode" type="checkbox"
                checked={template?.hysteresis_mode === "region"}
                aria-describedby="det-hysteresis-mode-desc"
                onChange={(e) => onUpdate({ hysteresis_mode: e.target.checked ? "region" : "score" })}
                className="w-4 h-4 accent-accent-blue focus-visible:outline-2 focus-visible:outline-accent-blue"
              />
              <label htmlFor="det-hysteresis-mode" className="text-xs 2xl:text-sm text-text-muted">{t("detector.hysteresisMode")}</label>
            </div>
            <p id="det-hysteresis-mode-desc" className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.hysteresisModeDesc")}</p>
          </div>
          {/* Hysteresis explanation */}
          <p className="text-[11px] leading-relaxed text-text-muted bg-bg-primary rounded-none px-3 py-2 border border-border-subtle">
            {t("detector.cooldownHint", { pct: String(Math.round(hysteresisFactor * 100)) })}
          </p>

          {/* Adaptive Polling section */}
          <div className="border-t border-border-subtle pt-3">
            <p className="text-xs 2xl:text-sm text-text-muted font-semibold mb-1">{t("detector.adaptivePolling")}</p>
            <p className="text-[11px] leading-relaxed text-text-muted mb-3">{t("detector.adaptivePollingDesc")}</p>
            {(() => {
              const errs = pollErrors;
              const inputBase = "w-full bg-bg-primary border rounded-none px-2 py-1 text-sm text-text-primary outline-none";
              const okBorder = "border-border-subtle focus:border-accent-blue/50";
              const errBorder = "border-accent-red/60 focus:border-accent-red";
              return (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="det-base-poll" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.basePoll")}</label>
                      <input
                        id="det-base-poll" type="number" min={10} max={2000} step={10} value={pollIntervalMs}
                        aria-invalid={errs.base ? true : undefined}
                        aria-describedby={errs.base ? "det-base-poll-err" : undefined}
                        onChange={(e) => onUpdate({ poll_interval_ms: Number.parseInt(e.target.value, 10) || 50 })}
                        className={`${inputBase} ${errs.base ? errBorder : okBorder}`}
                      />
                      {errs.base ? (
                        <p id="det-base-poll-err" className="text-[11px] leading-relaxed text-accent-red mt-0.5">{t(errs.base, { min: minPollMs, max: maxPollMs })}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.basePollDesc")}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="det-min-poll" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.minPoll")}</label>
                      <input
                        id="det-min-poll" type="number" min={10} max={1000} step={5} value={minPollMs}
                        aria-invalid={errs.min ? true : undefined}
                        aria-describedby={errs.min ? "det-min-poll-err" : undefined}
                        onChange={(e) => onUpdate({ min_poll_ms: Number.parseInt(e.target.value, 10) || 30 })}
                        className={`${inputBase} ${errs.min ? errBorder : okBorder}`}
                      />
                      {errs.min ? (
                        <p id="det-min-poll-err" className="text-[11px] leading-relaxed text-accent-red mt-0.5">{t(errs.min, { max: maxPollMs })}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.minPollDesc")}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="det-max-poll" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.maxPoll")}</label>
                      <input
                        id="det-max-poll" type="number" min={100} max={5000} step={50} value={maxPollMs}
                        aria-invalid={errs.max ? true : undefined}
                        aria-describedby={errs.max ? "det-max-poll-err" : undefined}
                        onChange={(e) => onUpdate({ max_poll_ms: Number.parseInt(e.target.value, 10) || 500 })}
                        className={`${inputBase} ${errs.max ? errBorder : okBorder}`}
                      />
                      {errs.max ? (
                        <p id="det-max-poll-err" className="text-[11px] leading-relaxed text-accent-red mt-0.5">{t(errs.max, { min: minPollMs })}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.maxPollDesc")}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-text-muted mt-2">
                    {t("detector.pollFpsHint", {
                      minFps: (1000 / Math.max(1, maxPollMs)).toFixed(1),
                      maxFps: (1000 / Math.max(1, minPollMs)).toFixed(1),
                    })}
                  </p>
                </>
              );
            })()}
          </div>

          {/* Hunt-type preset */}
          {activePreset && onApplyDefaults && (
            <div className="flex items-center justify-between py-2 border-t border-border-subtle">
              <span className="text-xs text-text-muted">{t("detector.odds")}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-secondary">
                  {activePreset.odds_numer} / {activePreset.odds_denom}
                </span>
                <button
                  onClick={onApplyDefaults}
                  title={t("detector.tooltipApplyDefaults")}
                  className="px-2 py-0.5 rounded-none text-xs font-medium border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors"
                >
                  {t("detector.applyDefaults")}
                </button>
              </div>
            </div>
          )}

          {/* Save + Reset */}
          <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
            <button
              onClick={onReset}
              className="text-xs text-text-muted hover:text-text-primary transition-colors underline underline-offset-2"
            >
              {t("detector.resetSettings")}
            </button>
            <button
              onClick={onSave}
              disabled={!settingsDirty || hasPollErrors}
              title={hasPollErrors ? t("detector.errPollInvalid") : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-none text-xs font-semibold transition-colors ${
                settingsDirty && !hasPollErrors
                  ? "bg-accent-blue text-white hover:bg-accent-blue/90"
                  : "bg-bg-hover border border-border-subtle text-text-muted cursor-default opacity-60"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              {t("detector.saveSettings")}
            </button>
          </div>
        </div>
  );

  const content = template ? settingsContent : emptyState;

  if (embedded) {
    return content;
  }

  return (
    <div
      data-detector-tutorial="settings"
      className="bg-bg-card border border-border-subtle rounded-none shadow-sm overflow-hidden"
    >
      <button
        onClick={() => setShowSettings((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover transition-colors"
      >
        <span className="flex items-center gap-2 text-xs text-text-muted font-semibold uppercase tracking-wider">
          <Settings className="w-3.5 h-3.5" />
          {t("detector.settings")}
        </span>
        <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${showSettings ? "rotate-180" : ""}`} />
      </button>

      {showSettings && content}
    </div>
  );
}
