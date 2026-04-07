/**
 * DetectorPerfModal — dev-only diagnostic modal that shows live runtime
 * performance metrics for the active detector loop.
 *
 * Surfaces three groups of numbers, polled once per second while open:
 *   1. Detector loop  — detect() wallclock duration (EMA + p95),
 *      effective FPS, current adaptive polling interval, smoothed score.
 *   2. Process CPU    — per-process CPU% and RSS for the renderer, GPU,
 *      browser and utility processes via Electron's app.getAppMetrics().
 *   3. Hardware       — one-shot snapshot of the GPU adapter and active
 *      backend reported by Electron's app.getGPUInfo('complete').
 *
 * The component is lazy-loaded from DetectorPanel and only mounted when
 * `import.meta.env.DEV` is true, so production bundles do not ship it.
 */

import { useEffect, useRef, useState, type JSX } from "react";
import { X, Activity, Cpu, MonitorCog } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { getActiveLoop } from "../../engine/DetectionLoop";

// ── Types ────────────────────────────────────────────────────────────────────

interface DetectorPerfModalProps {
  pokemonId: string | null;
  onClose: () => void;
}

interface LoopSnapshot {
  running: boolean;
  framesProcessed: number;
  lastDetectMs: number;
  detectMsEMA: number;
  detectMsP95: number;
  effectiveFps: number;
  pollIntervalMs: number;
  minPollMs: number;
  maxPollMs: number;
  smoothedScore: number;
  inHysteresis: boolean;
  inCooldown: boolean;
}

const POLL_INTERVAL_MS = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a millisecond duration with one decimal place. */
function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return `${ms.toFixed(1)} ms`;
}

/** Format a percentage with one decimal place. */
function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)} %`;
}

/** Format a memory size in MB with no decimals. */
function fmtMB(mb: number): string {
  if (!Number.isFinite(mb)) return "—";
  return `${Math.round(mb)} MB`;
}

/** Pull the active GPU adapter description out of an Electron getGPUInfo result. */
function describeGpuDevice(info: GpuInfoBasic | null): string | null {
  if (!info?.gpuDevice || info.gpuDevice.length === 0) return null;
  const active = info.gpuDevice.find((d) => d.active) ?? info.gpuDevice[0];
  const parts = [active.deviceString, active.driverVendor, active.driverVersion]
    .filter((s): s is string => Boolean(s && s.length > 0));
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ── Component ────────────────────────────────────────────────────────────────

/** Dev-only modal that streams live detector + process metrics. */
export default function DetectorPerfModal({
  pokemonId,
  onClose,
}: Readonly<DetectorPerfModalProps>): JSX.Element {
  const { t } = useI18n();
  const [loopSnap, setLoopSnap] = useState<LoopSnapshot | null>(null);
  const [procStats, setProcStats] = useState<ProcessStats | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GpuInfoBasic | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the close button on mount for keyboard accessibility.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // One-shot GPU info on mount.
  useEffect(() => {
    if (!window.electronAPI?.getGpuInfo) return;
    window.electronAPI
      .getGpuInfo()
      .then((info) => setGpuInfo(info))
      .catch(() => setGpuInfo(null));
  }, []);

  // Live polling of loop snapshot + process stats.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      // Loop snapshot is in-process and free.
      if (pokemonId) {
        const loop = getActiveLoop(pokemonId);
        setLoopSnap(loop ? loop.getPerfSnapshot() : null);
      } else {
        setLoopSnap(null);
      }
      // Process stats only available inside Electron.
      if (window.electronAPI?.getProcessStats) {
        try {
          const stats = await window.electronAPI.getProcessStats();
          if (!cancelled) {
            setProcStats(stats);
            setErrorMsg(null);
          }
        } catch (err) {
          if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pokemonId]);

  const inElectron = Boolean(window.electronAPI?.isElectron);
  const gpuDevice = describeGpuDevice(gpuInfo);

  return (
    <dialog
      open
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center m-0 p-0 border-none max-w-none max-h-none w-full h-full"
      aria-label={t("perfModal.title")}
    >
      <div className="bg-bg-card rounded-xl border border-border-subtle shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent-blue" />
            {t("perfModal.title")}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary focus-visible:outline-2 focus-visible:outline-accent-blue"
            aria-label={t("perfModal.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Section 1 — Detector Loop */}
          <section aria-labelledby="perf-loop-heading">
            <h3 id="perf-loop-heading" className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              {t("perfModal.loopHeading")}
            </h3>
            {loopSnap ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <Row label={t("perfModal.detectMs")} value={fmtMs(loopSnap.detectMsEMA)} hint={t("perfModal.detectMsHint", { last: fmtMs(loopSnap.lastDetectMs), p95: fmtMs(loopSnap.detectMsP95) })} />
                <Row label={t("perfModal.effectiveFps")} value={loopSnap.effectiveFps > 0 ? loopSnap.effectiveFps.toFixed(1) : "—"} hint={t("perfModal.effectiveFpsHint")} />
                <Row label={t("perfModal.pollInterval")} value={`${Math.round(loopSnap.pollIntervalMs)} ms`} hint={t("perfModal.pollIntervalHint", { min: loopSnap.minPollMs, max: loopSnap.maxPollMs })} />
                <Row label={t("perfModal.smoothedScore")} value={loopSnap.smoothedScore.toFixed(3)} />
                <Row label={t("perfModal.framesProcessed")} value={String(loopSnap.framesProcessed)} />
                <Row label={t("perfModal.loopState")} value={loopSnap.inHysteresis ? t("perfModal.stateHysteresis") : loopSnap.inCooldown ? t("perfModal.stateCooldown") : loopSnap.running ? t("perfModal.stateRunning") : t("perfModal.stateStopped")} />
              </dl>
            ) : (
              <p className="text-sm text-text-muted italic">{t("perfModal.noActiveLoop")}</p>
            )}
          </section>

          {/* Section 2 — Process CPU */}
          <section aria-labelledby="perf-proc-heading">
            <h3 id="perf-proc-heading" className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              {t("perfModal.processHeading")}
            </h3>
            {!inElectron && (
              <p className="text-sm text-text-muted italic">{t("perfModal.electronOnly")}</p>
            )}
            {errorMsg && (
              <p className="text-sm text-red-400">{errorMsg}</p>
            )}
            {inElectron && procStats && (
              <>
                <p className="text-[11px] text-text-muted mb-2">{t("perfModal.cpuConvention")}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-text-muted border-b border-border-subtle">
                      <th className="py-1 font-semibold">{t("perfModal.colProcess")}</th>
                      <th className="py-1 font-semibold text-right">{t("perfModal.colCpu")}</th>
                      <th className="py-1 font-semibold text-right">{t("perfModal.colMem")}</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    <ProcRow label={t("perfModal.procRenderer")} sample={procStats.renderer} />
                    <ProcRow label={t("perfModal.procGpu")} sample={procStats.gpu} highlight />
                    <ProcRow label={t("perfModal.procBrowser")} sample={procStats.browser} />
                    {procStats.utility.map((u) => (
                      <ProcRow key={u.pid} label={`${t("perfModal.procUtility")} ${u.name ? `(${u.name})` : ""}`} sample={u} />
                    ))}
                    <tr className="border-t border-border-subtle font-semibold">
                      <td className="py-1.5">{t("perfModal.procTotal")}</td>
                      <td className="py-1.5 text-right">{fmtPct(procStats.totalCpuPct)}</td>
                      <td className="py-1.5 text-right">{fmtMB(procStats.totalMemMB)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[11px] text-text-muted mt-2">
                  {t("perfModal.coresInfo", {
                    cores: procStats.cpuCores,
                    pctOfAll: ((procStats.totalCpuPct / (procStats.cpuCores * 100)) * 100).toFixed(1),
                  })}
                </p>
              </>
            )}
          </section>

          {/* Section 3 — Hardware */}
          <section aria-labelledby="perf-hw-heading">
            <h3 id="perf-hw-heading" className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
              <MonitorCog className="w-3.5 h-3.5" />
              {t("perfModal.hardwareHeading")}
            </h3>
            {!inElectron ? (
              <p className="text-sm text-text-muted italic">{t("perfModal.electronOnly")}</p>
            ) : (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-text-muted">{t("perfModal.hwGpu")}</dt>
                <dd className="font-mono text-text-primary">{gpuDevice ?? t("perfModal.hwUnknown")}</dd>
                <dt className="text-text-muted">{t("perfModal.hwHardwareConcurrency")}</dt>
                <dd className="font-mono text-text-primary">{navigator.hardwareConcurrency ?? "—"}</dd>
                <dt className="text-text-muted">{t("perfModal.hwUserAgent")}</dt>
                <dd className="font-mono text-text-primary text-xs break-all">{navigator.userAgent}</dd>
              </dl>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border-subtle">
          <p className="text-[11px] text-text-muted">{t("perfModal.refreshHint", { seconds: POLL_INTERVAL_MS / 1000 })}</p>
        </div>
      </div>
    </dialog>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  value: string;
  hint?: string;
}

/** Single label/value row inside the loop section. */
function Row({ label, value, hint }: Readonly<RowProps>): JSX.Element {
  return (
    <>
      <dt className="text-text-muted" title={hint}>{label}</dt>
      <dd className="font-mono text-text-primary text-right" title={hint}>{value}</dd>
    </>
  );
}

interface ProcRowProps {
  label: string;
  sample: ProcessSample | null;
  highlight?: boolean;
}

/** Single process row inside the CPU/memory table. */
function ProcRow({ label, sample, highlight }: Readonly<ProcRowProps>): JSX.Element {
  return (
    <tr className={highlight ? "text-accent-blue" : undefined}>
      <td className="py-1 font-sans">{label}</td>
      <td className="py-1 text-right">{sample ? fmtPct(sample.cpuPct) : "—"}</td>
      <td className="py-1 text-right">{sample ? fmtMB(sample.memMB) : "—"}</td>
    </tr>
  );
}
