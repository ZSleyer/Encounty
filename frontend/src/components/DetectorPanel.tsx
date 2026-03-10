/**
 * DetectorPanel.tsx — Auto-detection configuration and monitoring panel.
 *
 * Displayed as a full-width section inside the Dashboard's "Detector" tab.
 * Always expanded (no collapsible behavior). Provides source selection,
 * live preview, template management (add/edit/delete/sprite), settings,
 * and real-time status display.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Eye, X, Camera, Plus, Pencil, Sparkles, Loader2, Video, VideoOff,
  ChevronDown, Settings,
} from "lucide-react";
import { DetectorConfig, DetectorRect, GameEntry, HuntTypePreset, Pokemon, DetectorTemplate, MatchedRegion } from "../types";
import { useI18n } from "../contexts/I18nContext";
import { useBrowserCapture } from "../hooks/useBrowserCapture";
import { TemplateEditor } from "./TemplateEditor";
import { getSpriteUrl } from "../utils/sprites";

// ── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DetectorConfig = {
  enabled: false,
  source_type: "browser_display",
  region: { x: 0, y: 0, w: 0, h: 0 },
  window_title: "",
  templates: [],
  precision: 0.80,
  consecutive_hits: 3,
  cooldown_sec: 5,
  change_threshold: 0.15,
  poll_interval_ms: 500,
};

// ── Props ────────────────────────────────────────────────────────────────────

export interface DetectorPanelProps {
  pokemon: Pokemon;
  onConfigChange: (cfg: DetectorConfig | null) => Promise<void> | void;
  isRunning: boolean;
  confidence: number;
  detectorState: "idle" | "match_active" | "cooldown" | string;
}

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

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [cfg, setCfg] = useState<DetectorConfig>(() => {
    const saved = pokemon.detector_config;
    if (!saved) return { ...DEFAULT_CONFIG };
    return {
      ...saved,
      precision: saved.precision || DEFAULT_CONFIG.precision,
      consecutive_hits: saved.consecutive_hits || DEFAULT_CONFIG.consecutive_hits,
      cooldown_sec: saved.cooldown_sec || DEFAULT_CONFIG.cooldown_sec,
      poll_interval_ms: saved.poll_interval_ms || DEFAULT_CONFIG.poll_interval_ms,
    };
  });
  const [templates, setTemplates] = useState<DetectorTemplate[]>(
    () => pokemon.detector_config?.templates ?? [],
  );

  // Template editor state
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<{
    index: number; url: string; regions: MatchedRegion[];
  } | null>(null);
  const [addingSprite, setAddingSprite] = useState(false);

  const {
    stream, videoRef, isCapturing, startCapture, stopCapture, captureFrame,
    error: captureError,
  } = useBrowserCapture(cfg.source_type);

  const pokemonOcrLang = LANG_MAP[pokemon.language ?? ""] ?? "eng";

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
      ...saved,
      precision: saved.precision || DEFAULT_CONFIG.precision,
      consecutive_hits: saved.consecutive_hits || DEFAULT_CONFIG.consecutive_hits,
      cooldown_sec: saved.cooldown_sec || DEFAULT_CONFIG.cooldown_sec,
      poll_interval_ms: saved.poll_interval_ms || DEFAULT_CONFIG.poll_interval_ms,
    });
    setTemplates(saved.templates ?? []);
  }, [pokemon.id, pokemon.detector_config]);

  // ── Hunt-type presets + games data ───────────────────────────────────────

  const [huntTypePresets, setHuntTypePresets] = useState<HuntTypePreset[]>([]);
  const [games, setGames] = useState<GameEntry[]>([]);
  const [pokedex, setPokedex] = useState<{ id: number; canonical: string; forms?: { canonical: string; sprite_id: number }[] }[]>([]);
  useEffect(() => {
    fetch("/api/hunt-types")
      .then((r) => r.json())
      .then((data) => setHuntTypePresets(data as HuntTypePreset[]))
      .catch(() => {});
    fetch("/api/games")
      .then((r) => r.json())
      .then((data) => setGames(data as GameEntry[]))
      .catch(() => {});
    fetch("/api/pokedex")
      .then((r) => r.json())
      .then((data) => setPokedex(data))
      .catch(() => {});
  }, []);

  // Determine the game's generation for sprite availability.
  const pokemonGame = useMemo(
    () => games.find((g) => g.key === pokemon.game),
    [games, pokemon.game],
  );
  // Classic pixel sprites only exist for Gen 1-5.
  const hasGameSprite = pokemonGame != null && pokemonGame.generation <= 5;

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

  // ── Frame submission loop for browser sources ──────────────────────────────

  useEffect(() => {
    let active = true;
    let timerId: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!isCapturing || !isRunning || !active) return;
      const blob = await captureFrame();
      if (blob) {
        try {
          await fetch(`/api/detector/${pokemon.id}/match_frame`, {
            method: "POST", body: blob,
          });
        } catch { /* retry on next loop */ }
      }
      if (active) timerId = setTimeout(loop, cfg.poll_interval_ms);
    };
    if (isRunning && isCapturing) loop();
    return () => { active = false; clearTimeout(timerId); };
  }, [isRunning, isCapturing, captureFrame, pokemon.id, cfg.poll_interval_ms]);

  useEffect(() => {
    if (captureError) setErrorMsg(captureError);
  }, [captureError]);

  // Wire stream to video element
  useEffect(() => {
    if (stream && videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, showAddTemplate, editingTemplate]);

  // ── Template operations ────────────────────────────────────────────────────

  const handleDeleteTemplate = async (index: number) => {
    try {
      const res = await fetch(`/api/detector/${pokemon.id}/template/${index}`, { method: "DELETE" });
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

  const handleSaveNewTemplate = async (payload: { imageBase64: string; regions: MatchedRegion[] }) => {
    const res = await fetch(`/api/detector/${pokemon.id}/template_upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = (await res.json()) as { path?: string };
      if (data.path) {
        const tmpl: DetectorTemplate = { image_path: data.path, regions: payload.regions };
        const newTemplates = [...templates, tmpl];
        setTemplates(newTemplates);
        const nextCfg = { ...cfg, templates: newTemplates };
        setCfg(nextCfg);
        onConfigChange(nextCfg);
        setErrorMsg(null);
        setShowAddTemplate(false);
      }
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
      url: `/api/detector/${pokemon.id}/template/${index}`,
      regions: tmpl.regions ?? [],
    });
  };

  const handleUpdateRegions = async (regions: MatchedRegion[]) => {
    if (!editingTemplate) return;
    const res = await fetch(
      `/api/detector/${pokemon.id}/template/${editingTemplate.index}`,
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
        const res = await fetch(`/api/detector/${pokemon.id}/sprite_template`, {
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

  // ── Start / Stop ───────────────────────────────────────────────────────────

  const handleStart = async () => {
    if (isStarting) return;
    // Gate: source must be connected before starting detection.
    if (cfg.source_type.startsWith("browser") && !isCapturing) {
      setErrorMsg(t("detector.errNoStream"));
      return;
    }
    if (templates.length === 0) { setErrorMsg(t("detector.errNoTemplates")); return; }

    setIsStarting(true);
    setErrorMsg(null);
    try {
      // Save config first and wait for it to persist, so the backend
      // sees the latest templates and settings when /start is called.
      await onConfigChange({ ...cfg, templates });
      const res = await fetch(`/api/detector/${pokemon.id}/start`, { method: "POST" });
      if (res.ok) setErrorMsg(null);
      else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? t("detector.errStartFailed"));
      }
    } catch { setErrorMsg(t("detector.errStartFailed")); }
    finally { setIsStarting(false); }
  };

  const handleStop = async () => {
    if (cfg.source_type.startsWith("browser")) stopCapture();
    try { await fetch(`/api/detector/${pokemon.id}/stop`, { method: "POST" }); } catch {}
  };

  // ── Settings expand/collapse ──────────────────────────────────────────────

  const [showSettings, setShowSettings] = useState(false);

  const handleResetSettings = () => {
    setCfg((prev) => ({
      ...prev,
      precision: DEFAULT_CONFIG.precision,
      consecutive_hits: DEFAULT_CONFIG.consecutive_hits,
      cooldown_sec: DEFAULT_CONFIG.cooldown_sec,
      poll_interval_ms: DEFAULT_CONFIG.poll_interval_ms,
    }));
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const { dot: dotClass, pulse } = stateDotClass(detectorState, isRunning);
  const canStart = isCapturing && templates.length > 0;
  const showAsRunning = isRunning || isStarting;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-5">

        {/* ── Control bar ─────────────────────────────────────────────────── */}
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-sm transition-colors bg-bg-card border ${
          showAsRunning
            ? detectorState === "match_active"
              ? "border-green-500/30"
              : "border-border-subtle"
            : "border-border-subtle"
        }`}>
          {/* Status indicator */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass} ${pulse || isStarting ? "animate-pulse" : ""}`} />
            <span className={`text-xs font-semibold truncate ${
              detectorState === "match_active" ? "text-green-400" :
              showAsRunning ? "text-accent-blue" : "text-text-muted"
            }`}>
              {isStarting
                ? t("detector.starting")
                : isRunning
                  ? stateLabel(detectorState, isRunning, t)
                  : t("detector.stopped")}
            </span>
          </div>

          {/* Start / Stop button */}
          <button
            onClick={isRunning ? handleStop : handleStart}
            disabled={isStarting || (!isRunning && !canStart)}
            title={!isRunning && !canStart ? (
              !isCapturing ? t("detector.errNoStream") : t("detector.errNoTemplates")
            ) : undefined}
            className={`px-5 py-1.5 rounded-lg text-xs font-bold transition-colors border flex-shrink-0 flex items-center gap-1.5 ${
              isRunning
                ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
                : isStarting
                  ? "bg-accent-blue/50 border-accent-blue/50 text-white cursor-wait"
                  : canStart
                    ? "bg-accent-blue border-accent-blue text-white hover:bg-accent-blue/90"
                    : "bg-bg-hover border-border-subtle text-text-muted cursor-not-allowed opacity-60"
            }`}
          >
            {isStarting && <Loader2 className="w-3 h-3 animate-spin" />}
            {isRunning ? t("detector.stop") : t("detector.start")}
          </button>
        </div>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {errorMsg && (
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 cursor-pointer"
            onClick={() => setErrorMsg(null)}
          >
            <span className="flex-1">{errorMsg}</span>
            <span className="flex-shrink-0 opacity-60">✕</span>
          </div>
        )}

        {/* ── Source + Preview ─────────────────────────────────────────────── */}
        <div className="bg-bg-card border border-border-subtle rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
            <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">
              {t("detector.source")}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={cfg.source_type}
                onChange={(e) => setCfg({ ...cfg, source_type: e.target.value as any })}
                className="bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-blue/50"
              >
                <option value="browser_camera">{t("detector.sourceCamera")}</option>
                <option value="browser_display">{t("detector.sourceBrowser")}</option>
              </select>
              {!stream ? (
                <button
                  onClick={startCapture}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
                >
                  <Video className="w-3.5 h-3.5" />
                  {t("detector.connect")}
                </button>
              ) : (
                <button
                  onClick={stopCapture}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-red-400 hover:border-red-400/30 transition-colors"
                >
                  <VideoOff className="w-3.5 h-3.5" />
                  {t("detector.disconnect")}
                </button>
              )}
            </div>
          </div>
          <div className="relative w-full aspect-video bg-black">
            {!stream ? (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <Camera className="w-10 h-10 text-white/20 mb-2" />
                <p className="text-xs text-white/30">{t("detector.noStream")}</p>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className="w-full h-full object-contain"
              />
            )}
          </div>
        </div>

        {/* ── Templates ───────────────────────────────────────────────────── */}
        <div className="bg-bg-card border border-border-subtle rounded-xl shadow-sm p-4">
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
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t("detector.addFromVideo")}
              </button>
              {hasGameSprite && (
                <button
                  onClick={handleAddSpriteTemplate}
                  disabled={addingSprite}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors disabled:opacity-50"
                >
                  {addingSprite ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {t("detector.addFromSprite")}
                </button>
              )}
            </div>
          </div>

          {templates.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {templates.map((tmpl, index) => (
                <div key={index} className="relative group">
                  <img
                    src={`/api/detector/${pokemon.id}/template/${index}`}
                    alt={`Template ${index + 1}`}
                    className="w-full aspect-square object-contain rounded-lg border border-border-subtle bg-bg-primary"
                  />
                  {/* Region count badge */}
                  {tmpl.regions && tmpl.regions.length > 0 && (
                    <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded font-mono">
                      {tmpl.regions.length}R
                    </span>
                  )}
                  {/* Overlay buttons on hover */}
                  <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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

        {/* ── Advanced Settings (collapsible) ─────────────────────────── */}
        <div className="bg-bg-card border border-border-subtle rounded-xl shadow-sm overflow-hidden">
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

          {showSettings && (
            <div className="px-4 pb-4 space-y-3 border-t border-border-subtle pt-3">
              {/* Precision slider */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-text-muted">{t("detector.precision")}</label>
                  <span className="text-xs text-text-secondary font-mono">{(cfg.precision * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range" min={0.5} max={1.0} step={0.01}
                  value={cfg.precision}
                  onChange={(e) => setCfg((prev) => ({ ...prev, precision: parseFloat(e.target.value) }))}
                  className="w-full accent-accent-blue"
                />
                <p className="text-[10px] text-text-faint mt-0.5">{t("detector.precisionDesc")}</p>
              </div>

              {/* Grid: cooldown + hits + interval */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">{t("detector.cooldown")}</label>
                  <input
                    type="number" min={1} max={120} value={cfg.cooldown_sec}
                    onChange={(e) => setCfg((prev) => ({ ...prev, cooldown_sec: parseInt(e.target.value, 10) || 1 }))}
                    className="w-full bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue/50"
                  />
                  <p className="text-[10px] text-text-faint mt-0.5">{t("detector.cooldownDesc")}</p>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">{t("detector.hits")}</label>
                  <input
                    type="number" min={1} max={10} value={cfg.consecutive_hits}
                    onChange={(e) => setCfg((prev) => ({ ...prev, consecutive_hits: parseInt(e.target.value, 10) || 1 }))}
                    className="w-full bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue/50"
                  />
                  <p className="text-[10px] text-text-faint mt-0.5">{t("detector.hitsDesc")}</p>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">{t("detector.interval")}</label>
                  <input
                    type="number" min={200} max={5000} step={100} value={cfg.poll_interval_ms}
                    onChange={(e) => setCfg((prev) => ({ ...prev, poll_interval_ms: parseInt(e.target.value, 10) || 500 }))}
                    className="w-full bg-bg-primary border border-border-subtle rounded-lg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue/50"
                  />
                  <p className="text-[10px] text-text-faint mt-0.5">{t("detector.intervalDesc")}</p>
                </div>
              </div>

              {/* Hunt-type preset */}
              {activePreset && (
                <div className="flex items-center justify-between py-2 border-t border-border-subtle">
                  <span className="text-xs text-text-muted">{t("detector.odds")}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-secondary">
                      {activePreset.odds_numer} / {activePreset.odds_denom}
                    </span>
                    <button
                      onClick={handleApplyDefaults}
                      className="px-2 py-0.5 rounded text-[11px] font-medium border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors"
                    >
                      {t("detector.applyDefaults")}
                    </button>
                  </div>
                </div>
              )}

              {/* Reset settings to defaults */}
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleResetSettings}
                  className="text-[11px] text-text-muted hover:text-text-primary transition-colors underline underline-offset-2"
                >
                  {t("detector.resetSettings")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Detection log ───────────────────────────────────────────────── */}
        {pokemon.detector_config?.detection_log && pokemon.detector_config.detection_log.length > 0 && (
          <div className="bg-bg-card border border-border-subtle rounded-xl shadow-sm p-4">
            <span className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-2">
              {t("detector.logTitle")}
            </span>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {[...pokemon.detector_config.detection_log].reverse().slice(0, 10).map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-text-muted font-mono">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                  <span className="text-green-400 font-mono">
                    {(entry.confidence * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

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
    </>
  );
}

export type { DetectorRect };
