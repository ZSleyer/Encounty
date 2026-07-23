/**
 * DetectorPanel.tsx — Auto-detection configuration and monitoring panel.
 *
 * Orchestrates source selection, template management, and detection controls.
 * Uses CaptureService for browser-native capture and DetectionLoop for
 * WebGPU/CPU template matching in the browser.
 */
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import {
  X, Plus, Pencil, HelpCircle, RotateCcw,
  MoreHorizontal, Download, Upload, FileDown, AlertTriangle, Video, VideoOff, Trash2,
  FlaskConical, Activity,
} from "lucide-react";
import { DetectorConfig, DetectorTemplate, HuntTypePreset, Pokemon, MatchedRegion, TemplateCalibration, Settings as SettingsType } from "../../types";
import {
  DEFAULT_PRECISION, DEFAULT_HYSTERESIS_FACTOR, DEFAULT_CONSECUTIVE_HITS,
  DEFAULT_COOLDOWN_SEC, DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS,
} from "../../engine/detectorDefaults";
import { useI18n } from "../../contexts/I18nContext";
import { preloadOcrLang } from "../../hooks/useOCR";
import { useToast } from "../../contexts/ToastContext";
import { useCaptureService, useCaptureVersion } from "../../contexts/CaptureServiceContext";
import { useCounterStore } from "../../hooks/useCounterState";
import { TemplateEditor } from "./TemplateEditor";
import { DetectorTutorial } from "./DetectorTutorial";
import { SourcePickerModal, SelectedSource } from "./SourcePickerModal";
import { DetectorPreview } from "./DetectorPreview";
import { DetectorSettings, type TemplateSettingsPatch } from "./DetectorSettings";
import { ImportTemplatesModal } from "./ImportTemplatesModal";
import { ConfirmModal } from "../shared/ConfirmModal";

// Dev-only: lazy-loaded GPU equivalence test modal
const GpuEquivalenceTest = import.meta.env.DEV
  ? lazy(() => import("./GpuEquivalenceTest"))
  : null;
// Dev-only: lazy-loaded detector performance modal
const DetectorPerfModal = import.meta.env.DEV
  ? lazy(() => import("./DetectorPerfModal"))
  : null;
import { apiUrl } from "../../utils/api";
import { getActiveLoop } from "../../engine/DetectionLoop";
import { ensureDetector, getDetectorBackend, setForceCPU, isForceCPU, stopDetectionForPokemon, reloadDetectionTemplates } from "../../engine/startDetection";
import type { DetectionLoop } from "../../engine/DetectionLoop";

// --- Default config ----------------------------------------------------------

const DEFAULT_CONFIG: DetectorConfig = {
  enabled: false,
  source_type: "browser_display",
  region: { x: 0, y: 0, w: 0, h: 0 },
  window_title: "",
  templates: [],
  change_threshold: 0.15,
};

// --- Props -------------------------------------------------------------------

export type DetectorPanelProps = Readonly<{
  pokemon: Pokemon;
  onConfigChange: (cfg: DetectorConfig | null) => Promise<void> | void;
  isRunning: boolean;
  confidence: number;
  detectorState: string;
  /** Called when the user confirms stopping the hunt (detection + timer) to disconnect a source. */
  onStopHunt?: () => void;
}>;

// --- Helpers -----------------------------------------------------------------

/** Derive a user-facing error message from a caught exception. */
function getErrorMessage(err: unknown, networkMsg: string, fallbackMsg: string): string {
  if (err instanceof TypeError) return networkMsg;
  if (err instanceof Error) return err.message;
  return fallbackMsg;
}

/** Seed a full settings draft from a template, falling back to hardcoded defaults for unset fields. */
function draftFromTemplate(tmpl: DetectorTemplate | null): Required<TemplateSettingsPatch> {
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

function stateDotClass(state: string, running: boolean): { dot: string; pulse: boolean } {
  if (!running) return { dot: "bg-text-muted", pulse: false };
  // Palette mirrors the TemplateEditor sparkline so users see the same colors
  // for the same detection states across the live detector and the preview.
  switch (state) {
    case "match": return { dot: "bg-accent-green", pulse: false };
    case "cooldown": return { dot: "bg-accent-purple", pulse: false };
    default: return { dot: "bg-accent-blue", pulse: true };
  }
}

function stateLabel(state: string, running: boolean, t: (k: string) => string): string {
  if (!running) return "\u2013";
  switch (state) {
    case "match": return t("detector.stateMatch");
    case "cooldown": return t("detector.stateCooldown");
    default: return t("detector.stateIdle");
  }
}

// Map ISO 639-1 (pokemon language) to tesseract language code.
const LANG_MAP: Record<string, string> = {
  de: "deu", fr: "fra", es: "spa", it: "ita", ja: "jpn", ko: "kor",
  "zh-hans": "chi_sim", "zh-hant": "chi_sim",
};

/**
 * Map the user's interface locale to the tesseract language code that should
 * be preloaded so the first OCR run does not pay worker init latency. We
 * always also preload `eng` as a universal fallback.
 */
const INTERFACE_LOCALE_TO_TESSERACT: Record<string, string> = {
  de: "deu", en: "eng", es: "spa", fr: "fra", ja: "jpn",
};

// --- Component ---------------------------------------------------------------

export function DetectorPanel({
  pokemon,
  isRunning,
  confidence,
  detectorState,
  onStopHunt,
}: DetectorPanelProps) {
  const { t, locale } = useI18n();
  const { push: pushToast, dismissByKey } = useToast();
  // Narrow selectors: subscribe only to this Pokemon's cooldown and the fields
  // used here, instead of the whole store, which changes several times per
  // second while any hunt is active.
  const appState = useCounterStore((s) => s.appState);
  const setDetectorStatus = useCounterStore((s) => s.setDetectorStatus);
  const clearDetectorStatus = useCounterStore((s) => s.clearDetectorStatus);
  const cooldownRemaining = useCounterStore(
    (s) => s.detectorStatus[pokemon.id]?.cooldown_remaining_ms ?? null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [isStarting] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [cfg, setCfg] = useState<DetectorConfig>(() => {
    const saved = pokemon.detector_config;
    if (!saved) return { ...DEFAULT_CONFIG };
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      source_type: saved.source_type || DEFAULT_CONFIG.source_type,
    };
  });
  const templates = useMemo(
    () => pokemon.detector_config?.templates ?? [],
    [pokemon.detector_config?.templates],
  );
  // The active template (single-active semantics: at most one is enabled at
  // a time via the "Aktives Template festlegen" toggle) owns every detection
  // setting shown in the Einstellungen tab — there is no hunt-level default.
  const activeTemplateIndex = useMemo(
    () => templates.findIndex((tmpl) => tmpl.enabled !== false),
    [templates],
  );
  const activeTemplate = activeTemplateIndex >= 0 ? templates[activeTemplateIndex] : null;

  // Draft of the active template's detection settings, edited in the
  // Einstellungen tab. Re-seeded whenever the active template changes so
  // switching templates always shows that template's own saved values
  // (discarding any unsaved draft from the previously active template).
  const [templateDraft, setTemplateDraft] = useState<Required<TemplateSettingsPatch>>(() => draftFromTemplate(activeTemplate));
  useEffect(() => {
    setTemplateDraft(draftFromTemplate(activeTemplate));
    setSettingsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplateIndex, activeTemplate?.template_db_id]);

  // Source picker state
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  // Template editor state
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<{
    index: number; url: string; regions: MatchedRegion[]; dbId?: number; name?: string;
    precision?: number; hysteresisFactor?: number; consecutiveHits?: number;
    cooldownSec?: number; pollIntervalMs?: number; minPollMs?: number; maxPollMs?: number;
  } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showGpuTest, setShowGpuTest] = useState(false);
  const [showPerfModal, setShowPerfModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ index: number; name: string } | null>(null);
  const [rightTab, setRightTab] = useState<"log" | "settings">("log");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dev console access: __openGpuEquivalence() opens the GPU equivalence
  // modal, whose own __gpuEquivalence global then exposes run()/export().
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const g = globalThis as unknown as { __openGpuEquivalence?: unknown };
    g.__openGpuEquivalence = () => setShowGpuTest(true);
    return () => {
      delete g.__openGpuEquivalence;
    };
  }, []);

  // Right panel split — draggable divider between templates and log/settings
  const [templatesHeight, setTemplatesHeight] = useState(() => {
    try {
      const stored = localStorage.getItem("encounty_detector_split");
      return stored ? Number(stored) : 500;
    } catch { return 500; }
  });
  const detectorDividerRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Per-pokemon detection loop (local ref for the currently viewed pokemon)
  const loopRef = useRef<DetectionLoop | null>(null);
  // Backend type for the CPU fallback warning
  const [detectorBackend, setDetectorBackend] = useState<"gpu" | "cpu" | null>(getDetectorBackend());
  // Dev-only: force CPU backend toggle
  const [isCpuForced, setIsCpuForced] = useState(isForceCPU());

  const capture = useCaptureService();
  // Subscribe to capture version changes so we re-render when streams start/stop
  useCaptureVersion();

  // Per-pokemon stream from the capture service
  const stream = capture.getStream(pokemon.id);
  const isCapturing = capture.isCapturing(pokemon.id);
  const captureSourceLabel = capture.getSourceLabel(pokemon.id);

  /** Open the source picker or start capture directly depending on platform. */
  /** Ref for the hidden file input used by dev_video source type. */
  const devVideoInputRef = useRef<HTMLInputElement>(null);

  const startCapture = useCallback(() => {
    // Normalize empty/legacy source_type to the default before processing.
    // The backend may persist an empty string that doesn't match the TS union.
    const raw = cfg.source_type as string;
    const sourceType = (!raw || raw === "screen_region" || raw === "window" || raw === "camera")
      ? DEFAULT_CONFIG.source_type
      : cfg.source_type;

    // Dev mode: open a file picker for a local video file
    if (sourceType === "dev_video") {
      devVideoInputRef.current?.click();
      return Promise.resolve();
    }

    if (sourceType === "browser_display" || sourceType === "browser_camera") {
      const isElectron = !!globalThis.electronAPI;
      const isWayland = !!globalThis.electronAPI?.isWayland;

      // On Wayland + Electron + display capture, skip the source picker and
      // go straight to the native PipeWire/xdg-desktop-portal picker.
      if (sourceType === "browser_display" && isElectron && isWayland) {
        return capture.startCapture(pokemon.id, sourceType);
      }

      // In Electron for display capture, or always for camera, show the source picker
      if ((sourceType === "browser_display" && isElectron) || sourceType === "browser_camera") {
        setShowSourcePicker(true);
        return Promise.resolve();
      }
      // Non-Electron display capture: fall through to browser-native picker
      return capture.startCapture(pokemon.id, sourceType);
    }
    return Promise.resolve();
  }, [cfg.source_type, capture, pokemon.id]);

  /** Handle dev video file selection. */
  const handleDevVideoFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const objectUrl = URL.createObjectURL(file);
    capture.startCapture(pokemon.id, "dev_video", objectUrl, file.name);
  }, [capture, pokemon.id]);

  /** Handle a source selection from the SourcePickerModal. */
  const handleSourceSelected = useCallback((source: SelectedSource) => {
    setShowSourcePicker(false);
    // Derive source type from the SelectedSource itself — cfg.source_type may
    // be empty or a legacy value that doesn't match the CaptureSourceType union.
    const st = source.type === "camera" ? "browser_camera" : "browser_display";
    capture.startCapture(pokemon.id, st, source.sourceId, source.label, source.stream);
  }, [capture, pokemon.id]);

  /** Disconnect the capture source. If a hunt is active, show a confirmation modal first. */
  const handleDisconnect = useCallback(() => {
    if (isRunning) {
      setShowDisconnectConfirm(true);
      return;
    }
    capture.stopCapture(pokemon.id);
  }, [capture, pokemon.id, isRunning]);

  /** Confirmed disconnect: stop hunt (detection + timer), then release capture. */
  const confirmDisconnect = useCallback(() => {
    onStopHunt?.();
    stopDetectionForPokemon(pokemon.id);
    capture.stopCapture(pokemon.id);
    setShowDisconnectConfirm(false);
  }, [capture, pokemon.id, onStopHunt]);

  const pokemonOcrLang = LANG_MAP[pokemon.language ?? ""] || "eng";

  // Preload the OCR worker for the interface language plus English so the
  // first user-triggered recognize() call does not pay worker init latency.
  // Other tesseract languages (e.g. when a pokemon uses kor / ita / chi_sim)
  // are still initialized lazily on demand.
  useEffect(() => {
    const interfaceLang = INTERFACE_LOCALE_TO_TESSERACT[locale] ?? "eng";
    preloadOcrLang(interfaceLang);
    if (interfaceLang !== "eng") preloadOcrLang("eng");
  }, [locale]);

  // Propagate capture errors from the shared service. captureError is an i18n
  // key, so translate it here to match the other errorMsg values.
  useEffect(() => {
    if (capture.captureError) setErrorMsg(t(capture.captureError));
  }, [capture.captureError, t]);

  // Once a capture source is active, clear the persistent "no source" error.
  useEffect(() => {
    if (isCapturing) dismissByKey("capture-source");
  }, [isCapturing, dismissByKey]);

  // Re-sync config settings when switching to a different pokemon.
  useEffect(() => {
    const saved = pokemon.detector_config;
    if (!saved) {
      setCfg({ ...DEFAULT_CONFIG });
      return;
    }
    setCfg({ ...DEFAULT_CONFIG, ...saved });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon.id]);

  // Re-seed the settings draft from the active template whenever
  // detector_config changes externally (a different client, a WebSocket
  // broadcast, or the active template itself changing). Skip while the user
  // is editing settings locally (dirty state) to avoid overwriting their input.
  useEffect(() => {
    if (settingsDirty) return;
    setTemplateDraft(draftFromTemplate(activeTemplate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon.detector_config, settingsDirty]);

  // --- Hunt-type presets ----------------------------------------------------

  const [huntTypePresets, setHuntTypePresets] = useState<HuntTypePreset[]>([]);
  useEffect(() => {
    fetch(apiUrl("/api/hunt-types"))
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setHuntTypePresets(data); })
      .catch(() => {});
  }, []);

  // Show tutorial on first visit
  useEffect(() => {
    const tutorialSeen = appState?.settings?.tutorial_seen?.auto_detection;
    if (!tutorialSeen) {
      const timer = setTimeout(() => setShowTutorial(true), 300);
      return () => clearTimeout(timer);
    }
  }, [appState?.settings?.tutorial_seen?.auto_detection]);

  // --- Detector singleton initialization (fires once globally) ---------------

  useEffect(() => {
    ensureDetector().then(() => setDetectorBackend(getDetectorBackend()));
  }, []);

  // Detection loops persist across tab switches. On remount, re-attach the
  // score callback so the UI shows live confidence updates again.
  useEffect(() => {
    const existing = getActiveLoop(pokemon.id);
    if (existing) {
      existing.onScore((score, state, cooldownMs) => {
        setDetectorStatus(pokemon.id, { state, confidence: score, poll_ms: 100, cooldown_remaining_ms: cooldownMs });
      });
      loopRef.current = existing;
    }
  }, [pokemon.id, setDetectorStatus]);

  const activePreset = useMemo(
    () => huntTypePresets.find((p) => p.key === pokemon.hunt_type),
    [huntTypePresets, pokemon.hunt_type],
  );

  const handleApplyDefaults = () => {
    if (!activePreset) return;
    setTemplateDraft((prev) => ({
      ...prev,
      cooldown_sec: activePreset.default_cooldown_sec,
      consecutive_hits: activePreset.default_consecutive_hits,
    }));
  };

  // --- Template operations ---------------------------------------------------

  const handleDeleteTemplate = async (index: number) => {
    try {
      const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/template/${index}`), { method: "DELETE" });
      if (!res.ok) setErrorMsg(t("detector.errDeleteTemplate"));
    } catch { setErrorMsg(t("detector.errDeleteTemplate")); }
  };

  /** PATCH with a single retry on network failure (TypeError). */
  const patchWithRetry = async (url: string, body: unknown): Promise<Response> => {
    try {
      return await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Network error — retry once after 500ms
      await new Promise(r => setTimeout(r, 500));
      return fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  };

  /** Activate the clicked template (backend disables all others). */
  const handleToggleTemplate = async (index: number) => {
    try {
      const res = await patchWithRetry(
        apiUrl(`/api/detector/${pokemon.id}/template/${index}`),
        { enabled: true },
      );
      if (!res.ok) {
        pushToast({ type: "error", title: t("detector.errSaveFailed") });
        return;
      }
      // Hot-reload detection loop if running
      if (isRunning && loopRef.current) {
        // Use latest templates from store after the WebSocket update
        setTimeout(() => {
          const latest = pokemon.detector_config?.templates ?? [];
          reloadDetectionTemplates(pokemon.id, latest);
        }, 200);
      }
    } catch (err) {
      const msg = err instanceof TypeError ? t("detector.errNetworkFailed") : t("detector.errSaveFailed");
      pushToast({ type: "error", title: msg });
    }
  };

  /** Update local editing state for template name. */
  const handleSaveNewTemplate = async (payload: {
    imageBase64: string; regions: MatchedRegion[]; name?: string; calibration?: TemplateCalibration;
    precision?: number; hysteresisFactor?: number; consecutiveHits?: number; cooldownSec?: number;
    pollIntervalMs?: number; minPollMs?: number; maxPollMs?: number;
  }) => {
    const {
      hysteresisFactor, consecutiveHits, cooldownSec, pollIntervalMs, minPollMs, maxPollMs, ...rest
    } = payload;
    const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/template_upload`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...rest,
        hysteresis_factor: hysteresisFactor,
        consecutive_hits: consecutiveHits,
        cooldown_sec: cooldownSec,
        poll_interval_ms: pollIntervalMs,
        min_poll_ms: minPollMs,
        max_poll_ms: maxPollMs,
      }),
    });
    if (res.ok) {
      setErrorMsg(null);
      setShowAddTemplate(false);
      dismissByKey("detector-templates");
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? t("detector.errCaptureFailed"));
    }
  };

  const handleEditTemplate = (index: number) => {
    const tmpl = templates[index];
    if (!tmpl) return;
    setEditingTemplate({
      index,
      url: apiUrl(`/api/detector/${pokemon.id}/template/${index}`),
      regions: tmpl.regions || [],
      dbId: tmpl.template_db_id,
      name: tmpl.name,
      precision: tmpl.precision,
      hysteresisFactor: tmpl.hysteresis_factor,
      consecutiveHits: tmpl.consecutive_hits,
      cooldownSec: tmpl.cooldown_sec,
      pollIntervalMs: tmpl.poll_interval_ms,
      minPollMs: tmpl.min_poll_ms,
      maxPollMs: tmpl.max_poll_ms,
    });
  };

  const handleUpdateRegions = async (
    regions: MatchedRegion[],
    opts?: {
      name?: string; precision?: number; hysteresisFactor?: number; consecutiveHits?: number;
      cooldownSec?: number; pollIntervalMs?: number; minPollMs?: number; maxPollMs?: number;
    },
  ) => {
    if (!editingTemplate) return;

    // Validate index — fall back to lookup by template_db_id if out of range
    let targetIndex = editingTemplate.index;
    if (targetIndex >= templates.length) {
      const correctedIndex = templates.findIndex(tmpl => tmpl.template_db_id === editingTemplate.dbId);
      if (correctedIndex === -1) {
        pushToast({ type: "error", title: t("detector.errTemplateNotFound") });
        return;
      }
      targetIndex = correctedIndex;
    }

    const patchData: Record<string, unknown> = { regions };
    if (opts?.name !== undefined) patchData.name = opts.name;
    // Always send every detection setting explicitly (value or null) so the
    // template always carries a concrete value after saving.
    patchData.precision = opts?.precision ?? null;
    patchData.hysteresis_factor = opts?.hysteresisFactor ?? null;
    patchData.consecutive_hits = opts?.consecutiveHits ?? null;
    patchData.cooldown_sec = opts?.cooldownSec ?? null;
    patchData.poll_interval_ms = opts?.pollIntervalMs ?? null;
    patchData.min_poll_ms = opts?.minPollMs ?? null;
    patchData.max_poll_ms = opts?.maxPollMs ?? null;

    try {
      const res = await patchWithRetry(
        apiUrl(`/api/detector/${pokemon.id}/template/${targetIndex}`),
        patchData,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? t("detector.errSaveFailed"));
      }
      setEditingTemplate(null);
      // Hot-reload detection loop if running
      if (isRunning && loopRef.current) {
        setTimeout(() => {
          const latest = pokemon.detector_config?.templates ?? [];
          reloadDetectionTemplates(pokemon.id, latest);
        }, 200);
      }
    } catch (err) {
      const msg = getErrorMessage(err, t("detector.errNetworkFailed"), t("detector.errSaveFailed"));
      pushToast({ type: "error", title: msg });
    }
  };

  const handleImportFromPokemon = async (sourcePokemonId: string, templateIndices?: number[]) => {
    try {
      const body: Record<string, unknown> = { source_pokemon_id: sourcePokemonId };
      if (templateIndices?.length) body.template_indices = templateIndices;
      const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/import_templates`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json() as { imported: number };
        pushToast({ type: "success", title: t("detector.importSuccess", { count: data.imported }) });
        dismissByKey("detector-templates");
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        pushToast({ type: "error", title: body.error ?? t("detector.errImportFailed") });
      }
    } catch { pushToast({ type: "error", title: t("detector.errImportFailed") }); }
    setShowImportModal(false);
  };

  const handleExportTemplates = () => {
    window.open(apiUrl(`/api/detector/${pokemon.id}/export_templates`), "_blank");
    setShowMoreMenu(false);
  };

  const handleImportFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/import_templates_file`), {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json() as { imported: number };
        pushToast({ type: "success", title: t("detector.importFileSuccess", { count: data.imported }) });
        dismissByKey("detector-templates");
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        pushToast({ type: "error", title: body.error ?? t("detector.errInvalidFile") });
      }
    } catch { pushToast({ type: "error", title: t("detector.errInvalidFile") }); }
    setShowMoreMenu(false);
  };

  // --- Settings handlers -----------------------------------------------------

  const handleResetSettings = () => {
    setTemplateDraft({
      precision: DEFAULT_PRECISION,
      hysteresis_factor: DEFAULT_HYSTERESIS_FACTOR,
      hysteresis_mode: "score",
      consecutive_hits: DEFAULT_CONSECUTIVE_HITS,
      cooldown_sec: DEFAULT_COOLDOWN_SEC,
      poll_interval_ms: DEFAULT_POLL_MS,
      min_poll_ms: MIN_POLL_MS,
      max_poll_ms: MAX_POLL_MS,
    });
    setSettingsDirty(true);
  };

  /** Persists the settings draft onto the active template via PATCH. */
  const handleSaveSettings = async () => {
    if (activeTemplateIndex < 0) return;
    try {
      const res = await patchWithRetry(
        apiUrl(`/api/detector/${pokemon.id}/template/${activeTemplateIndex}`),
        templateDraft,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? t("detector.errSaveFailed"));
      }
      setSettingsDirty(false);
      pushToast({ type: "success", title: t("detector.settingsSaved") });
      // Hot-reload detection loop if running
      if (isRunning && loopRef.current) {
        setTimeout(() => {
          const latest = pokemon.detector_config?.templates ?? [];
          reloadDetectionTemplates(pokemon.id, latest);
        }, 200);
      }
    } catch (err) {
      const msg = getErrorMessage(err, t("detector.errNetworkFailed"), t("detector.errSaveFailed"));
      pushToast({ type: "error", title: msg });
    }
  };

  /** Wrapper that updates the active template's settings draft and marks it dirty. */
  const updateTemplateDraft = (patch: TemplateSettingsPatch) => {
    setTemplateDraft((prev) => ({ ...prev, ...patch }));
    setSettingsDirty(true);
  };

  const handleApplyDefaultsWithDirty = () => {
    handleApplyDefaults();
    setSettingsDirty(true);
  };

  // --- Tutorial --------------------------------------------------------------

  const handleTutorialComplete = async () => {
    setShowTutorial(false);
    if (!appState?.settings) return;
    const updatedSettings: SettingsType = {
      ...appState.settings,
      tutorial_seen: {
        ...appState.settings.tutorial_seen,
        auto_detection: true,
      },
    };
    try {
      await fetch(apiUrl("/api/settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedSettings),
      });
    } catch (err) {
      console.error("Failed to save tutorial state:", err);
    }
  };

  const handleShowTutorial = () => {
    setShowTutorial(true);
  };

  /** Dev-only: toggle between GPU and CPU detector backend. */
  const handleToggleBackend = async () => {
    // Stop current detection if running
    if (isRunning) {
      stopDetectionForPokemon(pokemon.id);
      loopRef.current = null;
      clearDetectorStatus(pokemon.id);
    }
    const newForce = !isCpuForced;
    setForceCPU(newForce);
    setIsCpuForced(newForce);
    // Re-initialize detector with new backend
    await ensureDetector();
    setDetectorBackend(getDetectorBackend());
  };

  /** Starts dragging the divider between templates and log/settings panels. */
  const startDetectorDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    detectorDividerRef.current = { startY: e.clientY, startHeight: templatesHeight };
    const onMove = (ev: MouseEvent) => {
      if (!detectorDividerRef.current) return;
      const dy = ev.clientY - detectorDividerRef.current.startY;
      const newH = Math.max(80, Math.min(detectorDividerRef.current.startHeight + dy, window.innerHeight - 250));
      setTemplatesHeight(newH);
    };
    const onUp = () => {
      globalThis.removeEventListener("mousemove", onMove);
      globalThis.removeEventListener("mouseup", onUp);
      setTemplatesHeight(h => { try { localStorage.setItem("encounty_detector_split", String(h)); } catch {} return h; });
      detectorDividerRef.current = null;
    };
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup", onUp);
  }, [templatesHeight]);

  /** Resizes the templates/log divider via arrow keys, mirroring the mouse-drag clamping and persistence. */
  const handleDetectorDividerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = e.key === "ArrowUp" ? -24 : 24;
    setTemplatesHeight(h => {
      const newH = Math.max(80, Math.min(h + step, window.innerHeight - 250));
      try { localStorage.setItem("encounty_detector_split", String(newH)); } catch {}
      return newH;
    });
  }, []);

  // --- Derived ---------------------------------------------------------------

  const { dot: dotClass, pulse } = stateDotClass(detectorState, isRunning);
  const showAsRunning = isRunning || isStarting;

  // --- Render ----------------------------------------------------------------

  return (
    <>
      {/* Hidden file input for dev_video source type */}
      {import.meta.env.DEV && (
        <input
          ref={devVideoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleDevVideoFile}
        />
      )}

      <div className="flex flex-col h-full bg-bg-card">
        {/* Control Bar — slim top bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-card border-b border-border-subtle shrink-0">
          {/* Status indicator */}
          <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotClass} ${pulse || isStarting ? "animate-pulse" : ""}`} />
          <span className={`text-xs font-semibold truncate ${(() => {
            if (detectorState === "match") return "text-accent-green";
            return showAsRunning ? "text-accent-blue" : "text-text-muted";
          })()}`}>
            {(() => {
              if (isStarting) return t("detector.starting");
              if (isRunning) {
                const label = stateLabel(detectorState, isRunning, t);
                if (detectorState === "cooldown" && cooldownRemaining != null) {
                  return `${label} (${Math.ceil(cooldownRemaining / 1000)}s)`;
                }
                return label;
              }
              return t("detector.stopped");
            })()}
          </span>

          {/* Pokemon name */}
          <span className="text-sm font-medium text-text-secondary truncate">{pokemon.name}</span>

          {/* CPU fallback badge */}
          {detectorBackend === "cpu" && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] font-medium bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20 shrink-0" title={t("detector.cpuFallbackWarning")}>
              <AlertTriangle className="w-3 h-3" />
              CPU
            </span>
          )}

          {/* Dev-only: GPU/CPU backend toggle */}
          {import.meta.env.DEV && (
            <button
              onClick={handleToggleBackend}
              className="flex items-center gap-0.5 h-5 rounded-none text-[10px] font-medium border shrink-0 transition-colors overflow-hidden"
              style={{
                borderColor: "rgba(148,163,184,0.2)",
                backgroundColor: "rgba(148,163,184,0.05)",
              }}
              title={`Switch to ${detectorBackend === "gpu" ? "CPU" : "GPU"} backend`}
            >
              <span className={`px-1.5 py-0.5 rounded-none text-[10px] font-semibold transition-colors ${
                detectorBackend === "gpu" ? "bg-accent-green/20 text-accent-green" : "text-text-muted"
              }`}>GPU</span>
              <span className={`px-1.5 py-0.5 rounded-none text-[10px] font-semibold transition-colors ${
                detectorBackend === "gpu" ? "text-text-muted" : "bg-accent-yellow/20 text-accent-yellow"
              }`}>CPU</span>
            </button>
          )}

          {/* Error badge — inline compact pill */}
          {errorMsg && (
            <button
              onClick={() => setErrorMsg(null)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] font-medium bg-accent-red/10 text-accent-red border border-accent-red/20 shrink-0 max-w-xs truncate"
              title={errorMsg}
            >
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="truncate">{errorMsg}</span>
              <span className="shrink-0 opacity-60 ml-0.5">{"\u2715"}</span>
            </button>
          )}

          {/* Confidence bar — only when running */}
          {isRunning && (
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <div className="flex-1 h-1.5 bg-bg-primary rounded-none overflow-hidden">
                <div
                  className={`h-full rounded-none transition-all duration-150 ${
                    confidence >= (activeTemplate?.precision ?? DEFAULT_PRECISION) ? "bg-accent-green" : "bg-accent-blue/50"
                  }`}
                  style={{ width: `${Math.min(confidence * 100, 100)}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-text-muted shrink-0 w-10 text-right">
                {(confidence * 100).toFixed(1)}%
              </span>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Source selector + connect/disconnect */}
          <div className="flex items-center gap-2 shrink-0" data-detector-tutorial="source">
            <select
              value={cfg.source_type || "browser_display"}
              onChange={(e) => setCfg((prev) => ({ ...prev, source_type: e.target.value as DetectorConfig["source_type"] }))}
              aria-label={t("detector.source")}
              className="bg-bg-primary border border-border-subtle rounded-none px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-blue/50"
            >
              <option value="browser_display">{t("detector.sourceBrowser")}</option>
              <option value="browser_camera">{t("detector.sourceCamera")}</option>
              {import.meta.env.DEV && (
                <option value="dev_video">Video File (Dev)</option>
              )}
            </select>
            {import.meta.env.DEV && (
              <button
                onClick={() => setShowGpuTest(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-none text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-accent-purple hover:border-accent-purple/30 transition-colors"
                aria-label="GPU Equivalence Test"
                title="GPU Equivalence Test"
              >
                <FlaskConical className="w-3.5 h-3.5" />
              </button>
            )}
            {import.meta.env.DEV && (
              <button
                onClick={() => setShowPerfModal(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-none text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-accent-blue hover:border-accent-blue/30 transition-colors"
                aria-label={t("perfModal.title")}
                title={t("perfModal.title")}
              >
                <Activity className="w-3.5 h-3.5" />
              </button>
            )}
            {isCapturing ? (
              <>
                {captureSourceLabel && (
                  <span className="text-[11px] text-text-muted truncate max-w-35" title={captureSourceLabel}>
                    {captureSourceLabel}
                  </span>
                )}
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-accent-red hover:border-accent-red/30 transition-colors"
                  aria-label={t("detector.disconnect")}
                >
                  <VideoOff className="w-3.5 h-3.5" />
                  {t("detector.disconnect")}
                </button>
              </>
            ) : (
              <button
                onClick={startCapture}
                className="t-cut flex items-center gap-1.5 px-3 py-1 rounded-none text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
                aria-label={t("detector.connect")}
              >
                <Video className="w-3.5 h-3.5" />
                {t("detector.connect")}
              </button>
            )}
          </div>

          {/* Tutorial button */}
          <button
            onClick={handleShowTutorial}
            className="p-1.5 rounded-none text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t("tooltip.editor.showTutorial")}
            aria-label="Tutorial"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Main content — fills remaining height, no gaps, full bleed */}
        <div className="flex-1 min-h-0 flex bg-bg-card">
          {/* Left: Preview — 16:9 constrained */}
          <div className="flex-1 min-w-0">
            <DetectorPreview
              pokemon={pokemon}
              precision={activeTemplate?.precision}
              isRunning={isRunning}
              confidence={confidence}
            />
          </div>

          {/* Right: Templates top, divider, Log/Settings bottom */}
          <div className="w-80 xl:w-96 shrink-0 flex flex-col min-h-0 border-l border-border-subtle bg-bg-card" data-detector-tutorial="templates">
              {/* Templates header */}
              <div className="flex items-center flex-wrap justify-between gap-x-1.5 gap-y-1.5 px-4 py-2.5 border-b border-border-subtle shrink-0">
                <span className="text-xs font-semibold text-text-primary whitespace-nowrap">
                  {t("detector.templates")}
                  {templates.length > 0 && (
                    <span className="ml-1 text-[10px] bg-accent-blue/20 text-accent-blue px-1 py-0.5 rounded-none">
                      {templates.length}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      if (!stream) { setErrorMsg(t("detector.errNoStream")); return; }
                      setShowAddTemplate(true);
                    }}
                    disabled={isRunning}
                    title={isRunning ? t("detector.disabledWhileRunning") : t("detector.tooltipAddFromVideo")}
                    aria-label={t("detector.tooltipAddFromVideo")}
                    aria-disabled={isRunning || undefined}
                    className={`flex items-center gap-1 px-2 py-1 rounded-none text-[11px] font-semibold whitespace-nowrap bg-accent-blue hover:bg-accent-blue/90 transition-colors ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Plus className="w-3 h-3" />
                    {t("detector.addFromVideo")}
                  </button>
                  <button
                    onClick={() => setShowImportModal(true)}
                    disabled={isRunning}
                    title={isRunning ? t("detector.disabledWhileRunning") : t("detector.importFromPokemon")}
                    aria-label={t("detector.importFromPokemon")}
                    aria-disabled={isRunning || undefined}
                    className={`flex items-center gap-1 px-2 py-1 rounded-none text-[11px] font-semibold whitespace-nowrap bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Upload className="w-3 h-3" />
                    {t("detector.importTemplates")}
                  </button>
                  {/* More menu — export, file import, clear */}
                  <div className="relative">
                    <button
                      onClick={() => setShowMoreMenu((v) => !v)}
                      disabled={isRunning}
                      className={`p-1.5 rounded-none bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                      title={isRunning ? t("detector.disabledWhileRunning") : t("detector.more")}
                      aria-label={t("detector.more")}
                      aria-disabled={isRunning || undefined}
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                    {showMoreMenu && (
                      <>
                        <button className="fixed inset-0 z-40 cursor-default" onClick={() => setShowMoreMenu(false)} aria-label={t("aria.close")} />
                        <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-none shadow-lg py-1 min-w-48">
                          {templates.length > 0 && (
                            <button
                              onClick={handleExportTemplates}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {t("detector.exportTemplates")}
                            </button>
                          )}
                          <button
                            onClick={() => { fileInputRef.current?.click(); setShowMoreMenu(false); }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            {t("detector.importFromFile")}
                          </button>
                          {templates.length > 0 && (
                            <>
                              <div className="my-1 border-t border-border-subtle" />
                              <button
                                onClick={() => {
                                  void fetch(apiUrl(`/api/detector/${pokemon.id}/templates`), { method: "DELETE" }).catch(() => {});
                                  setShowMoreMenu(false);
                                }}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-accent-red hover:bg-accent-red/10 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {t("detector.clearTemplates")}
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".encounty-templates,.zip"
                    className="hidden"
                    onChange={handleImportFromFile}
                  />
                </div>
              </div>
              {/* Template grid */}
              <div className="p-4 overflow-y-auto shrink-0" style={{ height: templatesHeight }}>
                {templates.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {templates.map((tmpl, index) => {
                      const isDimmed = tmpl.regions.length === 0 || tmpl.enabled === false;
                      return (
                      <div
                        key={`template-${tmpl.image_path}-${index}`}
                        className={`relative group rounded-none overflow-hidden transition-all w-full bg-bg-primary ${
                          (() => {
                            if (tmpl.regions.length === 0) return "ring-1 ring-accent-yellow/50";
                            if (tmpl.enabled === false) return "ring-1 ring-border-subtle";
                            return "ring-2 ring-accent-blue";
                          })()
                        }`}
                      >
                        {/* Clickable toggle area — disabled during active hunt or when template has no regions */}
                        <button
                          type="button"
                          className={`w-full text-left bg-transparent border-none p-0 ${
                            isRunning || tmpl.regions.length === 0 ? "cursor-default" : "cursor-pointer"
                          }`}
                          onClick={() => {
                            if (tmpl.regions.length === 0) { handleEditTemplate(index); return; }
                            if (!isRunning) handleToggleTemplate(index);
                          }}
                          disabled={isRunning && tmpl.regions.length > 0}
                          aria-label={`${tmpl.name || "Template " + (index + 1)}, ${
                            tmpl.regions.length === 0 ? t("templateEditor.templateInvalid") : t("detector.setActiveTemplate")
                          }`}
                        >
                          {/* Radio indicator for active selection — disabled for invalid templates */}
                          <div className={`absolute top-1 left-1 z-10 pointer-events-none ${isDimmed ? "opacity-60" : ""}`}>
                            <div className={`w-3.5 h-3.5 rounded-none border-2 flex items-center justify-center ${
                              (() => {
                                if (tmpl.regions.length === 0) return "border-accent-yellow/50 bg-transparent";
                                if (tmpl.enabled === false) return "border-text-muted bg-transparent";
                                return "border-accent-blue bg-accent-blue";
                              })()
                            }`}>
                              {tmpl.enabled !== false && tmpl.regions.length > 0 && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                          </div>

                          {/* Thumbnail — fixed 16:9 container with centered image. Dimming lives
                              here (not on the name label below) so the label text keeps full
                              contrast even when the template is invalid/disabled. */}
                          <div className={`relative w-full aspect-video bg-black/40 ${isDimmed ? "opacity-60" : ""}`}>
                            <img
                              src={apiUrl(`/api/detector/${pokemon.id}/template/${index}`)}
                              alt={tmpl.name || `Template ${index + 1}`}
                              className="absolute inset-0 w-full h-full object-contain"
                            />
                            {/* Invalid template overlay — shown when template has no regions */}
                            {tmpl.regions.length === 0 && (
                              <div aria-hidden="true" className="absolute inset-0 bg-accent-yellow/20 flex items-center justify-center rounded-none">
                                <div className="flex items-center gap-1.5 bg-black/70 px-2 py-1 rounded-none text-xs text-accent-yellow font-medium">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {t("templateEditor.templateInvalid")}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Template name — read-only display */}
                          <div className="px-1.5 py-0.5 bg-bg-primary">
                            <span className="block text-[10px] text-text-secondary truncate">
                              {tmpl.name || `Template ${index + 1}`}
                            </span>
                          </div>
                        </button>

                        {/* Hover overlay with edit/delete buttons — hidden while detection is running */}
                        {!isRunning && (
                          <div className="absolute inset-0 bg-black/50 rounded-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                            <button
                              type="button"
                              onClick={() => handleEditTemplate(index)}
                              className="p-1.5 rounded-none bg-white/20 text-white hover:bg-accent-blue transition-colors pointer-events-auto"
                              title={t("detector.editTemplate")}
                              aria-label={t("detector.editTemplate")}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm({ index, name: tmpl.name || `Template ${index + 1}` })}
                              className="p-1.5 rounded-none bg-white/20 text-white hover:bg-accent-red transition-colors pointer-events-auto"
                              title={t("detector.deleteTemplate")}
                              aria-label={t("detector.deleteTemplate")}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted text-center py-4">
                    {t("detector.noTemplates")}
                  </p>
                )}
              </div>

              {/* Draggable divider */}
              <div className="relative group shrink-0">
                <button
                  type="button"
                  onMouseDown={startDetectorDividerDrag}
                  onKeyDown={handleDetectorDividerKeyDown}
                  className="w-full h-6 cursor-row-resize bg-transparent border-none p-0 flex items-center"
                  aria-label={t("detector.resizeDivider")}
                >
                  {/* 24px tall hit target (WCAG 2.5.8) with a 6px visible bar centered inside */}
                  <span className="w-full h-1.5 bg-border-subtle group-hover:bg-accent-blue/40 group-active:bg-accent-blue/60 transition-colors" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTemplatesHeight(500);
                    try { localStorage.removeItem("encounty_detector_split"); } catch {}
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-bg-secondary border border-border-subtle rounded-none p-1 text-text-muted hover:text-text-primary transition-opacity z-10"
                  title={t("detector.resetLayout")}
                  aria-label={t("detector.resetLayout")}
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>

              {/* Log + Settings tabs */}
              <div className="flex shrink-0 border-b border-border-subtle items-center">
                {([["log", t("detector.logTitle")], ["settings", t("detector.settingsTitle")]] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setRightTab(tab)}
                    className={`flex-1 px-2 py-2 min-h-6 text-xs font-medium transition-colors ${
                      rightTab === tab
                        ? "text-accent-blue border-b-2 border-accent-blue bg-accent-blue/5"
                        : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {rightTab === "log" && (pokemon.detector_config?.detection_log?.length ?? 0) > 0 && (
                  <button
                    onClick={() => {
                      void fetch(apiUrl(`/api/detector/${pokemon.id}/detection_log`), { method: "DELETE" }).catch(() => {});
                    }}
                    title={t("detector.clearLog")}
                    aria-label={t("detector.clearLog")}
                    className="p-1.5 mr-1 text-text-muted hover:text-accent-red transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Tab content */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {rightTab === "log" && (
                  <div className="space-y-1.5">
                    {/* Precision threshold context */}
                    {(pokemon.detector_config?.detection_log?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-2 px-3 py-1.5 mb-1 text-[10px] text-text-faint">
                        <span>{t("detector.precision")}: {((activeTemplate?.precision ?? DEFAULT_PRECISION) * 100).toFixed(0)}%</span>
                        <span>·</span>
                        <span>{pokemon.detector_config?.detection_log?.length ?? 0} {t("detector.logEntryCount")}</span>
                      </div>
                    )}
                    {(() => {
                      const log = pokemon.detector_config?.detection_log;
                      if (!log || log.length === 0) {
                        return (
                          <p className="text-xs text-text-muted text-center py-4">
                            {t("detector.noLogEntries")}
                          </p>
                        );
                      }
                      return [...log].reverse().map((entry, i) => {
                        const pct = Math.min(entry.confidence * 100, 100);
                        const isMatch = entry.confidence >= (activeTemplate?.precision ?? DEFAULT_PRECISION);
                        return (
                          <div
                            key={`log-${entry.at}-${i}`}
                            className={`relative rounded-none px-3 py-2 text-xs transition-colors overflow-hidden ${
                              isMatch ? "bg-accent-green/8 border border-accent-green/20" : "bg-bg-primary border border-border-subtle"
                            }`}
                          >
                            {/* Confidence bar background */}
                            <div
                              className={`absolute inset-y-0 left-0 transition-all duration-300 ${
                                isMatch ? "bg-accent-green/10" : "bg-accent-blue/5"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                            {/* Content */}
                            <div className="relative flex items-center gap-2">
                              {isMatch && (
                                <span className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" />
                              )}
                              <span className={`font-mono font-bold shrink-0 ${
                                isMatch ? "text-accent-green" : "text-text-muted"
                              }`}>
                                {pct.toFixed(1)}%
                              </span>
                              <span className="text-text-faint">·</span>
                              <time className="text-text-faint font-mono shrink-0">
                                {new Date(entry.at).toLocaleTimeString()}
                              </time>
                              {entry.category && (
                                <>
                                  <span className="text-text-faint">·</span>
                                  <span className="px-1.5 py-0.5 rounded-none bg-accent-blue/15 text-accent-blue font-medium truncate max-w-[40%]">
                                    {entry.category}
                                  </span>
                                </>
                              )}
                              <div className="flex-1" />
                              {isMatch && (
                                <span className="text-[10px] font-bold text-accent-green uppercase tracking-wider">
                                  Match
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}

                {rightTab === "settings" && (
                  <DetectorSettings
                    template={activeTemplate ? { ...activeTemplate, ...templateDraft } : null}
                    onUpdate={updateTemplateDraft}
                    onSave={handleSaveSettings}
                    onReset={handleResetSettings}
                    settingsDirty={settingsDirty}
                    activePreset={activePreset}
                    onApplyDefaults={handleApplyDefaultsWithDirty}
                    embedded
                    disabled={isRunning}
                  />
                )}
              </div>
          </div>
        </div>
      </div>

      {/* --- Template Editor: Add from Video --------------------------------- */}
      {showAddTemplate && stream && (
        <TemplateEditor
          stream={stream}
          pokemonName={pokemon.name}
          ocrLang={pokemonOcrLang}
          onClose={() => setShowAddTemplate(false)}
          onSaveTemplate={handleSaveNewTemplate}
        />
      )}

      {/* --- Template Editor: Edit existing ---------------------------------- */}
      {editingTemplate && (
        <TemplateEditor
          initialImageUrl={editingTemplate.url}
          initialRegions={editingTemplate.regions}
          initialName={editingTemplate.name}
          pokemonName={pokemon.name}
          ocrLang={pokemonOcrLang}
          initialPrecision={editingTemplate.precision}
          initialHysteresisFactor={editingTemplate.hysteresisFactor}
          initialConsecutiveHits={editingTemplate.consecutiveHits}
          initialCooldownSec={editingTemplate.cooldownSec}
          initialPollIntervalMs={editingTemplate.pollIntervalMs}
          initialMinPollMs={editingTemplate.minPollMs}
          initialMaxPollMs={editingTemplate.maxPollMs}
          onClose={() => setEditingTemplate(null)}
          onUpdateRegions={handleUpdateRegions}
        />
      )}

      {/* --- Tutorial -------------------------------------------------------- */}
      {showTutorial && (
        <DetectorTutorial onComplete={handleTutorialComplete} />
      )}

      {/* --- Source Picker --------------------------------------------------- */}
      {showSourcePicker && (
        <SourcePickerModal
          sourceType={cfg.source_type as "browser_display" | "browser_camera"}
          pokemonId={pokemon.id}
          onSelect={handleSourceSelected}
          onClose={() => setShowSourcePicker(false)}
        />
      )}

      {/* --- Import Templates Modal ----------------------------------------- */}
      {showImportModal && (
        <ImportTemplatesModal
          currentPokemonId={pokemon.id}
          onImport={handleImportFromPokemon}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {deleteConfirm && (
        <ConfirmModal
          title={t("detector.confirmDeleteTitle")}
          message={t("detector.confirmDeleteTemplate", { name: deleteConfirm.name })}
          confirmLabel={t("detector.deleteTemplate")}
          isDestructive
          onConfirm={() => { handleDeleteTemplate(deleteConfirm.index); setDeleteConfirm(null); }}
          onClose={() => setDeleteConfirm(null)}
        />
      )}

      {showDisconnectConfirm && (
        <ConfirmModal
          title={t("detector.confirmDisconnectTitle")}
          message={t("detector.confirmDisconnectMessage")}
          confirmLabel={t("detector.confirmDisconnectYes")}
          isDestructive
          onConfirm={confirmDisconnect}
          onClose={() => setShowDisconnectConfirm(false)}
        />
      )}

      {import.meta.env.DEV && showGpuTest && GpuEquivalenceTest && (
        <Suspense fallback={null}>
          <GpuEquivalenceTest onClose={() => setShowGpuTest(false)} />
        </Suspense>
      )}

      {import.meta.env.DEV && showPerfModal && DetectorPerfModal && (
        <Suspense fallback={null}>
          <DetectorPerfModal pokemonId={pokemon.id} onClose={() => setShowPerfModal(false)} />
        </Suspense>
      )}
    </>
  );
}
