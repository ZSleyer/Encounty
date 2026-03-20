/**
 * DetectorPanel.tsx — Auto-detection configuration and monitoring panel.
 *
 * Orchestrates source selection, template management, and detection controls.
 * Uses DetectorPreview for live video display and DetectorSettings for
 * configuration options.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X, Plus, Pencil, Sparkles, Loader2, HelpCircle, Eye, EyeOff,
  MoreHorizontal, Download, Upload, FileDown,
} from "lucide-react";
import { DetectorCapabilities, DetectorConfig, GameEntry, HuntTypePreset, Pokemon, DetectorTemplate, MatchedRegion, Settings as SettingsType } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { useCaptureService, useCaptureVersion } from "../../contexts/CaptureServiceContext";
import { useCounterStore } from "../../hooks/useCounterState";
import { TemplateEditor } from "./TemplateEditor";
import { DetectorTutorial } from "./DetectorTutorial";
import { SourcePickerModal, SelectedSource } from "./SourcePickerModal";
import { DetectorPreview } from "./DetectorPreview";
import { DetectorSettings } from "./DetectorSettings";
import { ImportTemplatesModal } from "./ImportTemplatesModal";
import { getSpriteUrl } from "../../utils/sprites";
import { apiUrl } from "../../utils/api";

// ── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DetectorConfig = {
  enabled: false,
  source_type: "browser_display",
  region: { x: 0, y: 0, w: 0, h: 0 },
  window_title: "",
  templates: [],
  precision: 0.8,
  consecutive_hits: 1,
  cooldown_sec: 8,
  change_threshold: 0.15,
  poll_interval_ms: 50,
  min_poll_ms: 30,
  max_poll_ms: 500,
  adaptive_cooldown: false,
  adaptive_cooldown_min: 3,
  relative_regions: false,
};

// ── Props ────────────────────────────────────────────────────────────────────

export type DetectorPanelProps = Readonly<{
  pokemon: Pokemon;
  onConfigChange: (cfg: DetectorConfig | null) => Promise<void> | void;
  isRunning: boolean;
  confidence: number;
  detectorState: string;
}>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function stateDotClass(state: string, running: boolean): { dot: string; pulse: boolean } {
  if (!running) return { dot: "bg-text-muted", pulse: false };
  switch (state) {
    case "match_active": return { dot: "bg-green-400", pulse: false };
    case "cooldown": return { dot: "bg-amber-400", pulse: false };
    default: return { dot: "bg-accent-blue", pulse: true };
  }
}

function stateLabel(state: string, running: boolean, t: (k: string) => string): string {
  if (!running) return "–";
  switch (state) {
    case "match_active": return t("detector.stateMatch");
    case "cooldown": return t("detector.stateCooldown");
    default: return t("detector.stateIdle");
  }
}

// Map ISO 639-1 (pokemon language) → tesseract language code.
const LANG_MAP: Record<string, string> = {
  de: "deu", fr: "fra", es: "spa", it: "ita", ja: "jpn", ko: "kor",
  "zh-hans": "chi_sim", "zh-hant": "chi_sim",
};

// ── Component ────────────────────────────────────────────────────────────────

export function DetectorPanel({
  pokemon,
  onConfigChange,
  isRunning,
  confidence,
  detectorState,
}: DetectorPanelProps) {
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const { appState } = useCounterStore();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [cfg, setCfg] = useState<DetectorConfig>(() => {
    const saved = pokemon.detector_config;
    if (!saved) return { ...DEFAULT_CONFIG };
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      precision: saved.precision || DEFAULT_CONFIG.precision,
      consecutive_hits: saved.consecutive_hits || DEFAULT_CONFIG.consecutive_hits,
      cooldown_sec: saved.cooldown_sec || DEFAULT_CONFIG.cooldown_sec,
      poll_interval_ms: saved.poll_interval_ms || DEFAULT_CONFIG.poll_interval_ms,
      min_poll_ms: saved.min_poll_ms || DEFAULT_CONFIG.min_poll_ms,
      max_poll_ms: saved.max_poll_ms || DEFAULT_CONFIG.max_poll_ms,
    };
  });
  const [templates, setTemplates] = useState<DetectorTemplate[]>(
    () => pokemon.detector_config?.templates || [],
  );

  // Source picker state
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  // Detector capabilities
  const [capabilities, setCapabilities] = useState<DetectorCapabilities | null>(null);
  useEffect(() => {
    fetch(apiUrl("/api/detector/capabilities"))
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setCapabilities(data as DetectorCapabilities); })
      .catch(() => {});
  }, []);

  // Template editor state
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<{
    index: number; url: string; regions: MatchedRegion[];
  } | null>(null);
  const [addingSprite, setAddingSprite] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const capture = useCaptureService();
  // Subscribe to capture version changes so we re-render when streams start/stop
  useCaptureVersion();

  // Per-pokemon stream from the capture service
  const stream = capture.getStream(pokemon.id);
  const isCapturing = capture.isCapturing(pokemon.id);

  const startCapture = useCallback(() => {
    // Native sources (window, camera) — always show the source picker so the
    // user can select a specific window/camera. The backend captures directly.
    if (cfg.source_type === "window" || cfg.source_type === "camera") {
      setShowSourcePicker(true);
      return Promise.resolve();
    }

    if (cfg.source_type === "browser_display" || cfg.source_type === "browser_camera") {
      const isElectron = !!globalThis.electronAPI;
      const isWayland = !!globalThis.electronAPI?.isWayland;

      // On Wayland + Electron + display capture, skip the source picker and
      // go straight to the native PipeWire/xdg-desktop-portal picker via getDisplayMedia.
      if (cfg.source_type === "browser_display" && isElectron && isWayland) {
        return capture.startCapture(pokemon.id, cfg.source_type);
      }

      // In Electron for display capture (non-Wayland), or always for camera, show the source picker
      if ((cfg.source_type === "browser_display" && isElectron) || cfg.source_type === "browser_camera") {
        setShowSourcePicker(true);
        return Promise.resolve();
      }
      // Non-Electron display capture: fall through to browser-native picker
      return capture.startCapture(pokemon.id, cfg.source_type);
    }
    return Promise.resolve();
  }, [cfg.source_type, capture, pokemon.id]);

  const handleSourceSelected = useCallback((source: SelectedSource) => {
    setShowSourcePicker(false);

    // Native sources: the backend captures directly — no browser MediaStream needed.
    // Save the selection to the config (window_title stores the source identifier)
    // and let the user start detection, which calls POST /api/detector/{id}/start.
    if (cfg.source_type === "window" || cfg.source_type === "camera") {
      setCfg((prev) => ({
        ...prev,
        window_title: source.sourceId,
      }));
      onConfigChange({
        ...cfg,
        window_title: source.sourceId,
        templates,
      });
      return;
    }

    // Browser sources: acquire a MediaStream via the capture service.
    const st = cfg.source_type as "browser_display" | "browser_camera";
    capture.startCapture(pokemon.id, st, source.sourceId, source.label, source.stream);
  }, [capture, pokemon.id, cfg.source_type, cfg, onConfigChange, templates]);

  const stopCapture = useCallback(() => {
    capture.stopCapture(pokemon.id);
  }, [capture, pokemon.id]);

  const pokemonOcrLang = LANG_MAP[pokemon.language ?? ""] || "eng";

  // Re-sync when the pokemon prop changes externally.
  // Merge with defaults so zero-valued fields from older saves get sensible values.
  useEffect(() => {
    const saved = pokemon.detector_config;
    if (!saved) {
      setCfg({ ...DEFAULT_CONFIG });
      setTemplates([]);
      return;
    }
    setCfg({
      ...DEFAULT_CONFIG,
      ...saved,
      precision: saved.precision || DEFAULT_CONFIG.precision,
      consecutive_hits: saved.consecutive_hits || DEFAULT_CONFIG.consecutive_hits,
      cooldown_sec: saved.cooldown_sec || DEFAULT_CONFIG.cooldown_sec,
      poll_interval_ms: saved.poll_interval_ms || DEFAULT_CONFIG.poll_interval_ms,
      min_poll_ms: saved.min_poll_ms || DEFAULT_CONFIG.min_poll_ms,
      max_poll_ms: saved.max_poll_ms || DEFAULT_CONFIG.max_poll_ms,
    });
    setTemplates(saved.templates || []);
  }, [pokemon.id, pokemon.detector_config]);

  // ── Hunt-type presets + games data ───────────────────────────────────────

  const [huntTypePresets, setHuntTypePresets] = useState<HuntTypePreset[]>([]);
  const [games, setGames] = useState<GameEntry[]>([]);
  const [pokedex, setPokedex] = useState<{ id: number; canonical: string; forms?: { canonical: string; sprite_id: number }[] }[]>([]);
  useEffect(() => {
    fetch(apiUrl("/api/hunt-types"))
      .then((r) => r.json())
      .then((data) => setHuntTypePresets(data as HuntTypePreset[]))
      .catch(() => {});
    fetch(apiUrl("/api/games"))
      .then((r) => r.json())
      .then((data) => setGames(data as GameEntry[]))
      .catch(() => {});
    fetch(apiUrl("/api/pokedex"))
      .then((r) => r.json())
      .then((data) => setPokedex(data))
      .catch(() => {});
  }, []);

  // Show tutorial on first visit
  useEffect(() => {
    const tutorialSeen = appState?.settings?.tutorial_seen?.auto_detection;
    if (!tutorialSeen) {
      // Small delay to ensure DOM is ready with data-detector-tutorial attributes
      const timer = setTimeout(() => setShowTutorial(true), 300);
      return () => clearTimeout(timer);
    }
  }, [appState?.settings?.tutorial_seen?.auto_detection]);

  // Determine the game's generation for sprite availability.
  const pokemonGame = useMemo(
    () => games.find((g) => g.key === pokemon.game),
    [games, pokemon.game],
  );
  // Classic pixel sprites only exist for Gen 1-5.
  const hasGameSprite = (pokemonGame?.generation ?? 0) <= 5 && pokemonGame != null;

  // Resolve canonical_name → numeric Pokédex/sprite ID for sprite URL generation.
  const pokedexSpriteId = useMemo(() => {
    if (!pokemon.canonical_name || pokedex.length === 0) return null;
    for (const entry of pokedex) {
      if (entry.canonical === pokemon.canonical_name) return entry.id;
      if (entry.forms) {
        for (const form of entry.forms) {
          if (form.canonical === pokemon.canonical_name) return form.sprite_id;
        }
      }
    }
    return null;
  }, [pokemon.canonical_name, pokedex]);

  const activePreset = useMemo(
    () => huntTypePresets.find((p) => p.key === pokemon.hunt_type),
    [huntTypePresets, pokemon.hunt_type],
  );

  const handleApplyDefaults = () => {
    if (!activePreset) return;
    setCfg((prev) => ({
      ...prev,
      cooldown_sec: activePreset.default_cooldown_sec,
      consecutive_hits: activePreset.default_consecutive_hits,
    }));
  };

  // Propagate capture errors from the shared service
  useEffect(() => {
    if (capture.captureError) setErrorMsg(capture.captureError);
  }, [capture.captureError]);

  // Re-register submitter when component mounts for an already-running detector
  // (e.g. user switched away and came back in the sidebar)
  useEffect(() => {
    if (isRunning && isCapturing && cfg.source_type.startsWith("browser")) {
      capture.registerSubmitter(pokemon.id, cfg.poll_interval_ms, cfg.region, cfg.change_threshold);
    }
  }, [pokemon.id]); // Only on pokemon change / mount

  // Sync poll interval to capture service when config changes
  useEffect(() => {
    if (isRunning) {
      capture.updateSubmitterInterval(pokemon.id, cfg.poll_interval_ms);
    }
  }, [cfg.poll_interval_ms, isRunning, pokemon.id, capture]);

  // ── Template operations ────────────────────────────────────────────────────

  const handleDeleteTemplate = async (index: number) => {
    try {
      const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/template/${index}`), { method: "DELETE" });
      if (res.ok) {
        const newTemplates = templates.filter((_, i) => i !== index);
        setTemplates(newTemplates);
        const nextCfg = { ...cfg, templates: newTemplates };
        setCfg(nextCfg);
        onConfigChange(nextCfg);
      } else {
        setErrorMsg(t("detector.errDeleteTemplate"));
      }
    } catch { setErrorMsg(t("detector.errDeleteTemplate")); }
  };

  const handleToggleTemplate = async (index: number) => {
    const tmpl = templates[index];
    if (!tmpl) return;
    const newEnabled = tmpl.enabled === false;
    try {
      const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/template/${index}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (res.ok) {
        const newTemplates = templates.map((t, i) =>
          i === index ? { ...t, enabled: newEnabled } : t,
        );
        setTemplates(newTemplates);
        const nextCfg = { ...cfg, templates: newTemplates };
        setCfg(nextCfg);
        onConfigChange(nextCfg);
      }
    } catch { /* ignore */ }
  };

  const handleSaveNewTemplate = async (payload: { imageBase64: string; regions: MatchedRegion[] }) => {
    const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/template_upload`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = (await res.json()) as { index?: number; template_db_id?: number };
      const tmpl: DetectorTemplate = {
        image_path: "",
        template_db_id: data.template_db_id ?? 0,
        regions: payload.regions,
      };
      const newTemplates = [...templates, tmpl];
      setTemplates(newTemplates);
      const nextCfg = { ...cfg, templates: newTemplates };
      setCfg(nextCfg);
      onConfigChange(nextCfg);
      setErrorMsg(null);
      setShowAddTemplate(false);
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
    });
  };

  const handleUpdateRegions = async (regions: MatchedRegion[]) => {
    if (!editingTemplate) return;
    const res = await fetch(
      apiUrl(`/api/detector/${pokemon.id}/template/${editingTemplate.index}`),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regions }) },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Failed to update template");
    }
    const newTemplates = templates.map((t, i) =>
      i === editingTemplate.index ? { ...t, regions } : t,
    );
    setTemplates(newTemplates);
    const nextCfg = { ...cfg, templates: newTemplates };
    setCfg(nextCfg);
    onConfigChange(nextCfg);
    setEditingTemplate(null);
  };

  const handleAddSpriteTemplate = async () => {
    setAddingSprite(true);
    setErrorMsg(null);
    try {
      // Add both normal AND shiny sprites as templates so both encounter
      // variants are recognized (the user hunts one but sees the other first).
      const spriteId = pokedexSpriteId ?? pokemon.canonical_name;
      const variants: { type: "normal" | "shiny"; url: string }[] = [
        { type: "normal", url: getSpriteUrl(spriteId, pokemon.game, "normal", "classic", pokemon.canonical_name) },
        { type: "shiny", url: getSpriteUrl(spriteId, pokemon.game, "shiny", "classic", pokemon.canonical_name) },
      ];

      let addedCount = 0;
      let newTemplates = [...templates];
      for (const variant of variants) {
        const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/sprite_template`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sprite_url: variant.url }),
        });
        if (res.ok) {
          const data = await res.json() as { path?: string };
          if (data.path) {
            // Empty regions array → full-image NCC match (the sprite IS the template).
            newTemplates.push({ image_path: data.path, regions: [] });
            addedCount++;
          }
        }
      }

      if (addedCount > 0) {
        setTemplates(newTemplates);
        const nextCfg = { ...cfg, templates: newTemplates };
        setCfg(nextCfg);
        onConfigChange(nextCfg);
      } else {
        setErrorMsg(t("detector.errCaptureFailed"));
      }
    } catch { setErrorMsg(t("detector.errCaptureFailed")); }
    finally { setAddingSprite(false); }
  };

  const handleImportFromPokemon = async (sourcePokemonId: string) => {
    try {
      const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/import_templates`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_pokemon_id: sourcePokemonId }),
      });
      if (res.ok) {
        const data = await res.json() as { imported: number };
        pushToast({ type: "success", title: t("detector.importSuccess").replace("{count}", String(data.imported)) });
        // Refresh templates from the server state
        const stateRes = await fetch(apiUrl(`/api/detector/${pokemon.id}/config`));
        if (stateRes.ok) {
          const config = await stateRes.json() as DetectorConfig;
          setTemplates(config.templates || []);
          setCfg((prev) => ({ ...prev, templates: config.templates || [] }));
        }
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        pushToast({ type: "error", title: body.error ?? "Import failed" });
      }
    } catch { pushToast({ type: "error", title: "Import failed" }); }
    setShowImportModal(false);
  };

  const handleExportTemplates = () => {
    window.open(apiUrl(`/api/detector/${pokemon.id}/export_templates`), "_blank");
    setShowMoreMenu(false);
  };

  const handleImportFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected
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
        pushToast({ type: "success", title: t("detector.importFileSuccess").replace("{count}", String(data.imported)) });
        const stateRes = await fetch(apiUrl(`/api/detector/${pokemon.id}/config`));
        if (stateRes.ok) {
          const config = await stateRes.json() as DetectorConfig;
          setTemplates(config.templates || []);
          setCfg((prev) => ({ ...prev, templates: config.templates || [] }));
        }
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        pushToast({ type: "error", title: body.error ?? t("detector.errInvalidFile") });
      }
    } catch { pushToast({ type: "error", title: t("detector.errInvalidFile") }); }
    setShowMoreMenu(false);
  };

  // ── Start / Stop ───────────────────────────────────────────────────────────

  const handleStart = async () => {
    if (isStarting) return;

    const isNativeSource = cfg.source_type === "window" || cfg.source_type === "camera";

    // Gate: browser sources must be connected before starting detection.
    // Native sources don't need a browser stream — the backend captures directly.
    if (!isNativeSource && !isCapturing) {
      setErrorMsg(t("detector.errNoStream"));
      return;
    }
    // Native sources require a window/camera selection stored in window_title.
    if (isNativeSource && !cfg.window_title) {
      setErrorMsg(t("detector.errNoSource"));
      return;
    }
    if (templates.length === 0) { setErrorMsg(t("detector.errNoTemplates")); return; }

    // Prevent starting when the selected source type is unsupported by the platform
    if (capabilities) {
      const unsupported =
        (cfg.source_type === "window" && !capabilities.supports_window_capture) ||
        (cfg.source_type === "camera" && !capabilities.supports_camera) ||
        (cfg.source_type === "screen_region" && !capabilities.supports_screen_capture);
      if (unsupported) {
        pushToast({ type: "error", title: t("detector.capWarning") });
        return;
      }
    }

    setIsStarting(true);
    setErrorMsg(null);
    try {
      // Save config first and wait for it to persist, so the backend
      // sees the latest templates and settings when /start is called.
      await onConfigChange({ ...cfg, templates });
      const res = await fetch(apiUrl(`/api/detector/${pokemon.id}/start`), { method: "POST" });
      if (res.ok) {
        setErrorMsg(null);
        // Register this pokemon for frame dispatch via the capture service
        // (only needed for browser sources — native sources are handled by the backend)
        if (cfg.source_type.startsWith("browser")) {
          capture.registerSubmitter(pokemon.id, cfg.poll_interval_ms, cfg.region, cfg.change_threshold);
        }
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? t("detector.errStartFailed"));
      }
    } catch { setErrorMsg(t("detector.errStartFailed")); }
    finally { setIsStarting(false); }
  };

  const handleStop = async () => {
    // Unregister from frame dispatch (does NOT stop the shared stream)
    capture.unregisterSubmitter(pokemon.id);
    try { await fetch(apiUrl(`/api/detector/${pokemon.id}/stop`), { method: "POST" }); } catch {}
  };

  // ── Settings handlers ──────────────────────────────────────────────────────

  const handleResetSettings = () => {
    setCfg((prev) => ({
      ...prev,
      precision: DEFAULT_CONFIG.precision,
      consecutive_hits: DEFAULT_CONFIG.consecutive_hits,
      cooldown_sec: DEFAULT_CONFIG.cooldown_sec,
      change_threshold: DEFAULT_CONFIG.change_threshold,
      poll_interval_ms: DEFAULT_CONFIG.poll_interval_ms,
      min_poll_ms: DEFAULT_CONFIG.min_poll_ms,
      max_poll_ms: DEFAULT_CONFIG.max_poll_ms,
    }));
    setSettingsDirty(true);
  };

  const handleSaveSettings = async () => {
    await onConfigChange({ ...cfg, templates });
    setSettingsDirty(false);
    pushToast({ type: "success", title: t("detector.settingsSaved") });
  };

  /** Wrapper that updates a cfg field and marks settings as dirty. */
  const updateCfg = (patch: Partial<DetectorConfig>) => {
    setCfg((prev) => ({ ...prev, ...patch }));
    setSettingsDirty(true);
  };

  const handleApplyDefaultsWithDirty = () => {
    handleApplyDefaults();
    setSettingsDirty(true);
  };

  // ── Tutorial ───────────────────────────────────────────────────────────────

  const handleTutorialComplete = async () => {
    setShowTutorial(false);
    // Mark tutorial as seen in backend
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

  // ── Derived ────────────────────────────────────────────────────────────────

  const { dot: dotClass, pulse } = stateDotClass(detectorState, isRunning);
  const isNativeSource = cfg.source_type === "window" || cfg.source_type === "camera";
  const canStart = isNativeSource
    ? (!!cfg.window_title && templates.length > 0)
    : (isCapturing && templates.length > 0);
  const showAsRunning = isRunning || isStarting;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-5">
        {/* ── Header with Tutorial button ─────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-secondary">
            {t("detector.title")}
          </h2>
          <button
            onClick={handleShowTutorial}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t("tooltip.editor.showTutorial")}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Tutorial
          </button>
        </div>

        {/* ── Control bar ─────────────────────────────────────────────────── */}
        <div
          data-detector-tutorial="controls"
          className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-sm transition-colors bg-bg-card border ${
          showAsRunning && detectorState === "match_active"
            ? "border-green-500/30"
            : "border-border-subtle"
        }`}>
          {/* Status indicator */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`inline-block w-2.5 h-2.5 2xl:w-3 2xl:h-3 rounded-full shrink-0 ${dotClass} ${pulse || isStarting ? "animate-pulse" : ""}`} />
            <span className={`text-xs 2xl:text-sm font-semibold truncate ${(() => {
              if (detectorState === "match_active") return "text-green-400";
              return showAsRunning ? "text-accent-blue" : "text-text-muted";
            })()}`}>
              {(() => {
                if (isStarting) return t("detector.starting");
                if (isRunning) return stateLabel(detectorState, isRunning, t);
                return t("detector.stopped");
              })()}
            </span>
          </div>

          {/* Confidence indicator */}
          {isRunning && (
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1 h-1.5 bg-bg-primary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-150 ${
                    confidence >= cfg.precision ? 'bg-green-400' : 'bg-accent-blue/50'
                  }`}
                  style={{ width: `${Math.min(confidence * 100, 100)}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-text-muted shrink-0 w-10 text-right">
                {(confidence * 100).toFixed(1)}%
              </span>
            </div>
          )}

          {/* Start / Stop button */}
          <button
            onClick={isRunning ? handleStop : handleStart}
            disabled={isStarting || (!isRunning && !canStart)}
            title={(() => {
              if (!isRunning && !canStart) {
                if (isNativeSource) return cfg.window_title ? t("detector.errNoTemplates") : t("detector.errNoSource");
                return isCapturing ? t("detector.errNoTemplates") : t("detector.errNoStream");
              }
              return isRunning ? t("detector.tooltipStop") : t("detector.tooltipStart");
            })()}
            className={(() => {
              const base = "px-5 py-1.5 2xl:px-6 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-bold transition-colors border shrink-0 flex items-center gap-1.5";
              if (isRunning) return `${base} bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20`;
              if (isStarting) return `${base} bg-accent-blue/50 border-accent-blue/50 text-white cursor-wait`;
              if (canStart) return `${base} bg-accent-blue border-accent-blue text-white hover:bg-accent-blue/90`;
              return `${base} bg-bg-hover border-border-subtle text-text-muted cursor-not-allowed opacity-60`;
            })()}
          >
            {isStarting && <Loader2 className="w-3 h-3 animate-spin" />}
            {isRunning ? t("detector.stop") : t("detector.start")}
          </button>
        </div>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {errorMsg && (
          <button
            type="button"
            className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 cursor-pointer w-full text-left"
            onClick={() => setErrorMsg(null)}
          >
            <span className="flex-1">{errorMsg}</span>
            <span className="shrink-0 opacity-60">✕</span>
          </button>
        )}

        {/* ── Preview Component ───────────────────────────────────────────────── */}
        <DetectorPreview
          pokemon={pokemon}
          cfg={cfg}
          capabilities={capabilities}
          onSourceTypeChange={(sourceType) => setCfg({ ...cfg, source_type: sourceType as any })}
          onStartCapture={startCapture}
          onStopCapture={stopCapture}
          isRunning={isRunning}
          confidence={confidence}
        />

        {/* ── Templates ───────────────────────────────────────────────────── */}
        <div
          data-detector-tutorial="templates"
          className="bg-bg-card border border-border-subtle rounded-xl shadow-sm p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">
              {t("detector.templates")}
              {templates.length > 0 && (
                <span className="ml-1.5 bg-accent-blue/20 text-accent-blue text-[10px] px-1.5 py-0.5 rounded-full">
                  {templates.length}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!stream) { setErrorMsg(t("detector.errNoStream")); return; }
                  setShowAddTemplate(true);
                }}
                title={t("detector.tooltipAddFromVideo")}
                className="flex items-center gap-1 px-2.5 py-1 2xl:px-3 2xl:py-1.5 rounded-lg text-[11px] 2xl:text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t("detector.addFromVideo")}
              </button>
              {hasGameSprite && (
                <button
                  onClick={handleAddSpriteTemplate}
                  disabled={addingSprite}
                  title={t("detector.tooltipAddFromSprite")}
                  className="flex items-center gap-1 px-2.5 py-1 2xl:px-3 2xl:py-1.5 rounded-lg text-[11px] 2xl:text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors disabled:opacity-50"
                >
                  {addingSprite ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {t("detector.addFromSprite")}
                </button>
              )}
              {/* More menu (import/export) */}
              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu((v) => !v)}
                  className="p-1.5 rounded-lg bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors"
                  title={t("detector.more")}
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                {showMoreMenu && (
                  <>
                    <button className="fixed inset-0 z-40 cursor-default" onClick={() => setShowMoreMenu(false)} aria-label="Close menu" />
                    <div className="absolute right-0 bottom-full mb-1 z-50 bg-bg-secondary border border-border-subtle rounded-lg shadow-lg py-1 min-w-45">
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
                        onClick={() => { setShowImportModal(true); setShowMoreMenu(false); }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {t("detector.importFromPokemon")}
                      </button>
                      <button
                        onClick={() => { fileInputRef.current?.click(); setShowMoreMenu(false); }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        {t("detector.importFromFile")}
                      </button>
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

          {templates.length > 0 ? (
            <div className="grid grid-cols-4 2xl:grid-cols-5 gap-2">
              {templates.map((tmpl, index) => (
                <div key={`template-${tmpl.image_path}-${index}`} className="relative group">
                  <img
                    src={apiUrl(`/api/detector/${pokemon.id}/template/${index}`)}
                    alt={`Template ${index + 1}`}
                    className={`w-full aspect-square object-contain rounded-lg border border-border-subtle bg-bg-primary transition-all ${
                      tmpl.enabled === false ? 'opacity-40 grayscale' : ''
                    }`}
                  />
                  {/* Region count badge */}
                  {(tmpl.regions?.length ?? 0) > 0 && (
                    <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded font-mono">
                      {tmpl.regions.length}R
                    </span>
                  )}
                  {/* Overlay buttons on hover */}
                  <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={() => handleToggleTemplate(index)}
                      className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-amber-500 transition-colors"
                      title={tmpl.enabled === false ? t("detector.enableTemplate") : t("detector.disableTemplate")}
                    >
                      {tmpl.enabled === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleEditTemplate(index)}
                      className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-accent-blue transition-colors"
                      title={t("detector.editTemplate")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(index)}
                      className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-red-500 transition-colors"
                      title={t("detector.deleteTemplate")}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-faint text-center py-4">
              {t("detector.noTemplates")}
            </p>
          )}
        </div>

        {/* ── Settings Component ──────────────────────────────────────────────── */}
        <DetectorSettings
          cfg={cfg}
          onUpdate={updateCfg}
          onSave={handleSaveSettings}
          onReset={handleResetSettings}
          settingsDirty={settingsDirty}
          activePreset={activePreset}
          onApplyDefaults={handleApplyDefaultsWithDirty}
        />
      </div>

      {/* ── Template Editor: Add from Video ────────────────────────────────── */}
      {showAddTemplate && stream && (
        <TemplateEditor
          stream={stream}
          pokemonName={pokemon.name}
          ocrLang={pokemonOcrLang}
          onClose={() => setShowAddTemplate(false)}
          onSaveTemplate={handleSaveNewTemplate}
        />
      )}

      {/* ── Template Editor: Edit existing ─────────────────────────────────── */}
      {editingTemplate && (
        <TemplateEditor
          initialImageUrl={editingTemplate.url}
          initialRegions={editingTemplate.regions}
          pokemonName={pokemon.name}
          ocrLang={pokemonOcrLang}
          onClose={() => setEditingTemplate(null)}
          onUpdateRegions={handleUpdateRegions}
        />
      )}

      {/* ── Tutorial ────────────────────────────────────────────────────────── */}
      {showTutorial && (
        <DetectorTutorial onComplete={handleTutorialComplete} />
      )}

      {/* ── Source Picker ──────────────────────────────────────────────────── */}
      {showSourcePicker && (
        <SourcePickerModal
          sourceType={cfg.source_type as "browser_display" | "browser_camera" | "window" | "camera"}
          capabilities={capabilities}
          onSelect={handleSourceSelected}
          onClose={() => setShowSourcePicker(false)}
        />
      )}

      {/* ── Import Templates Modal ───────────────────────────────────────── */}
      {showImportModal && (
        <ImportTemplatesModal
          currentPokemonId={pokemon.id}
          onImport={handleImportFromPokemon}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </>
  );
}
