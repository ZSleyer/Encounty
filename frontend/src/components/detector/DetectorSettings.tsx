/**
 * DetectorSettings.tsx — Advanced detector configuration panel.
 *
 * Collapsible section with threshold/precision sliders, polling interval
 * configuration (base, min, max poll), cooldown and consecutive hits settings,
 * and hunt-type preset integration.
 */
import { useState } from "react";
import { ChevronDown, Settings, Save } from "lucide-react";
import { DetectorConfig, HuntTypePreset } from "../../types";
import { useI18n } from "../../contexts/I18nContext";

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

// ── Props ────────────────────────────────────────────────────────────────────

export type DetectorSettingsProps = Readonly<{
  cfg: DetectorConfig;
  onUpdate: (patch: Partial<DetectorConfig>) => void;
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
  cfg,
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

  const pollErrors = validatePollIntervals(cfg.poll_interval_ms, cfg.min_poll_ms, cfg.max_poll_ms);
  const hasPollErrors = Boolean(pollErrors.base || pollErrors.min || pollErrors.max);

  /** The shared settings content rendered in both embedded and collapsible modes. */
  const settingsContent = (
    <div className={`${embedded ? "space-y-3" : "px-4 pb-4 space-y-3 border-t border-border-subtle pt-3"} ${disabled ? "opacity-50 pointer-events-none" : ""}`} aria-disabled={disabled || undefined}>
          {/* Precision slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="det-precision" className="text-xs 2xl:text-sm text-text-muted">{t("detector.precision")}</label>
              <span className="text-xs 2xl:text-sm text-text-secondary font-mono">{(cfg.precision * 100).toFixed(0)}%</span>
            </div>
            <input
              id="det-precision" type="range" min={0.5} max={1} step={0.01}
              value={cfg.precision}
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
                id="det-cooldown" type="number" min={0} max={120} value={cfg.cooldown_sec}
                onChange={(e) => onUpdate({ cooldown_sec: Number.parseInt(e.target.value, 10) || 0 })}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue/50"
              />
              <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.cooldownDesc")}</p>
            </div>
            <div>
              <label htmlFor="det-hits" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.hits")}</label>
              <input
                id="det-hits" type="number" min={1} max={10} value={cfg.consecutive_hits}
                onChange={(e) => onUpdate({ consecutive_hits: Number.parseInt(e.target.value, 10) || 1 })}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue/50"
              />
              <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.hitsDesc")}</p>
            </div>
          </div>
          {/* Hysteresis factor slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="det-hysteresis" className="text-xs 2xl:text-sm text-text-muted">{t("detector.hysteresis")}</label>
              <span className="text-xs 2xl:text-sm text-text-secondary font-mono">{((cfg.hysteresis_factor ?? 0.7) * 100).toFixed(0)}%</span>
            </div>
            <input
              id="det-hysteresis" type="range" min={0.5} max={0.95} step={0.05}
              value={cfg.hysteresis_factor ?? 0.7}
              onChange={(e) => onUpdate({ hysteresis_factor: Number.parseFloat(e.target.value) })}
              className="w-full accent-accent-blue"
            />
            <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.hysteresisDesc")}</p>
          </div>
          {/* Hysteresis explanation */}
          <p className="text-[11px] leading-relaxed text-text-muted bg-bg-primary rounded-lg px-3 py-2 border border-border-subtle">
            {t("detector.cooldownHint", { pct: String(Math.round((cfg.hysteresis_factor ?? 0.7) * 100)) })}
          </p>

          {/* Adaptive Polling section */}
          <div className="border-t border-border-subtle pt-3">
            <p className="text-xs 2xl:text-sm text-text-muted font-semibold mb-1">{t("detector.adaptivePolling")}</p>
            <p className="text-[11px] leading-relaxed text-text-muted mb-3">{t("detector.adaptivePollingDesc")}</p>
            {(() => {
              const errs = pollErrors;
              const inputBase = "w-full bg-bg-primary border rounded-lg px-2 py-1 text-sm text-text-primary outline-none";
              const okBorder = "border-border-subtle focus:border-accent-blue/50";
              const errBorder = "border-red-500/60 focus:border-red-500";
              return (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="det-base-poll" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.basePoll")}</label>
                      <input
                        id="det-base-poll" type="number" min={10} max={2000} step={10} value={cfg.poll_interval_ms}
                        aria-invalid={errs.base ? true : undefined}
                        aria-describedby={errs.base ? "det-base-poll-err" : undefined}
                        onChange={(e) => onUpdate({ poll_interval_ms: Number.parseInt(e.target.value, 10) || 50 })}
                        className={`${inputBase} ${errs.base ? errBorder : okBorder}`}
                      />
                      {errs.base ? (
                        <p id="det-base-poll-err" className="text-[11px] leading-relaxed text-red-400 mt-0.5">{t(errs.base, { min: cfg.min_poll_ms, max: cfg.max_poll_ms })}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.basePollDesc")}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="det-min-poll" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.minPoll")}</label>
                      <input
                        id="det-min-poll" type="number" min={10} max={1000} step={5} value={cfg.min_poll_ms}
                        aria-invalid={errs.min ? true : undefined}
                        aria-describedby={errs.min ? "det-min-poll-err" : undefined}
                        onChange={(e) => onUpdate({ min_poll_ms: Number.parseInt(e.target.value, 10) || 30 })}
                        className={`${inputBase} ${errs.min ? errBorder : okBorder}`}
                      />
                      {errs.min ? (
                        <p id="det-min-poll-err" className="text-[11px] leading-relaxed text-red-400 mt-0.5">{t(errs.min, { max: cfg.max_poll_ms })}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.minPollDesc")}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="det-max-poll" className="block text-xs 2xl:text-sm text-text-muted mb-1">{t("detector.maxPoll")}</label>
                      <input
                        id="det-max-poll" type="number" min={100} max={5000} step={50} value={cfg.max_poll_ms}
                        aria-invalid={errs.max ? true : undefined}
                        aria-describedby={errs.max ? "det-max-poll-err" : undefined}
                        onChange={(e) => onUpdate({ max_poll_ms: Number.parseInt(e.target.value, 10) || 500 })}
                        className={`${inputBase} ${errs.max ? errBorder : okBorder}`}
                      />
                      {errs.max ? (
                        <p id="det-max-poll-err" className="text-[11px] leading-relaxed text-red-400 mt-0.5">{t(errs.max, { min: cfg.min_poll_ms })}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">{t("detector.maxPollDesc")}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-text-muted mt-2">
                    {t("detector.pollFpsHint", {
                      minFps: (1000 / Math.max(1, cfg.max_poll_ms)).toFixed(1),
                      maxFps: (1000 / Math.max(1, cfg.min_poll_ms)).toFixed(1),
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
                  className="px-2 py-0.5 rounded text-xs font-medium border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors"
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
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

  if (embedded) {
    return settingsContent;
  }

  return (
    <div
      data-detector-tutorial="settings"
      className="bg-bg-card border border-border-subtle rounded-xl shadow-sm overflow-hidden"
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

      {showSettings && settingsContent}
    </div>
  );
}
