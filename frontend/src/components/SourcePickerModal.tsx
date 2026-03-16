/**
 * SourcePickerModal.tsx — Discord-style source picker for screen/window/camera capture.
 *
 * Shows a tabbed modal with live thumbnails for screens and windows (via Electron
 * desktopCapturer) and camera devices (via navigator.mediaDevices.enumerateDevices).
 * Thumbnails refresh every 3 seconds for screens/windows.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { X, Monitor, AppWindow, Camera, RefreshCw } from "lucide-react";
import { useI18n } from "../contexts/I18nContext";

// --- Types -------------------------------------------------------------------

export interface SelectedSource {
  type: "screen" | "window" | "camera";
  sourceId: string;
  label: string;
}

interface SourcePickerModalProps {
  sourceType: "browser_display" | "browser_camera";
  onSelect: (source: SelectedSource) => void;
  onClose: () => void;
}

interface CameraDevice {
  deviceId: string;
  label: string;
}

type Tab = "screens" | "windows" | "cameras";

// --- Component ---------------------------------------------------------------

export function SourcePickerModal({ sourceType, onSelect, onClose }: SourcePickerModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isElectron = !!window.electronAPI;
  const isWayland = !!window.electronAPI?.isWayland;

  // On Wayland + display capture, skip the thumbnail picker entirely and let
  // the caller fall through to the native PipeWire/xdg-desktop-portal picker.
  useEffect(() => {
    if (isWayland && sourceType === "browser_display") {
      onClose();
    }
  }, [isWayland, sourceType, onClose]);

  // Determine available tabs based on source type
  const availableTabs: Tab[] =
    sourceType === "browser_camera" ? ["cameras"] : ["screens", "windows"];
  const [activeTab, setActiveTab] = useState<Tab>(availableTabs[0]);

  // Source data
  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Open dialog on mount
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Fetch capture sources (screens + windows) from Electron
  const fetchSources = useCallback(async () => {
    if (!isElectron || sourceType === "browser_camera" || isWayland) return;
    try {
      const sources = await window.electronAPI!.getCaptureSources();
      setCaptureSources(sources);
    } catch {
      setCaptureSources([]);
    }
    setLoading(false);
  }, [isElectron, sourceType, isWayland]);

  // Fetch camera devices
  const fetchCameras = useCallback(async () => {
    if (sourceType !== "browser_camera") return;
    try {
      // Request a temporary stream to get permission for device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices
        .filter(d => d.kind === "videoinput")
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 8)}` }));
      setCameras(videoInputs);
    } catch {
      setCameras([]);
    }
    setLoading(false);
  }, [sourceType]);

  // Initial fetch
  useEffect(() => {
    if (sourceType === "browser_camera") {
      fetchCameras();
    } else {
      fetchSources();
    }
  }, [sourceType, fetchSources, fetchCameras]);

  // Refresh thumbnails every 3 seconds for screens/windows
  useEffect(() => {
    if (sourceType === "browser_camera" || !isElectron || isWayland) return;
    const interval = setInterval(fetchSources, 3000);
    return () => clearInterval(interval);
  }, [sourceType, isElectron, fetchSources]);

  // Filter sources by active tab
  const filteredSources = captureSources.filter(s => {
    if (activeTab === "screens") return s.id.startsWith("screen:");
    if (activeTab === "windows") return !s.id.startsWith("screen:");
    return false;
  });

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  const handleSelect = () => {
    if (!selectedId) return;

    if (activeTab === "cameras") {
      const cam = cameras.find(c => c.deviceId === selectedId);
      if (cam) {
        onSelect({ type: "camera", sourceId: cam.deviceId, label: cam.label });
      }
    } else {
      const src = captureSources.find(s => s.id === selectedId);
      if (src) {
        const type = src.id.startsWith("screen:") ? "screen" : "window";
        onSelect({ type, sourceId: src.id, label: src.name });
      }
    }
  };

  const handleDoubleClick = (id: string) => {
    setSelectedId(id);
    // Use setTimeout so state updates before handleSelect reads it
    setTimeout(() => {
      if (activeTab === "cameras") {
        const cam = cameras.find(c => c.deviceId === id);
        if (cam) onSelect({ type: "camera", sourceId: cam.deviceId, label: cam.label });
      } else {
        const src = captureSources.find(s => s.id === id);
        if (src) {
          onSelect({
            type: src.id.startsWith("screen:") ? "screen" : "window",
            sourceId: src.id,
            label: src.name,
          });
        }
      }
    }, 0);
  };

  // Reset selection when switching tabs
  useEffect(() => {
    setSelectedId(null);
  }, [activeTab]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-0 w-full max-w-2xl animate-slide-in backdrop:bg-black/70"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="text-base font-bold text-text-primary">{t("sourcePicker.title")}</h2>
        <button
          onClick={handleCancel}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      {availableTabs.length > 1 && (
        <div className="flex gap-1 px-5 pb-3">
          {availableTabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? "bg-accent-blue text-white"
                  : "bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              {tab === "screens" && <Monitor className="w-3.5 h-3.5" />}
              {tab === "windows" && <AppWindow className="w-3.5 h-3.5" />}
              {tab === "cameras" && <Camera className="w-3.5 h-3.5" />}
              {t(`sourcePicker.${tab}`)}
            </button>
          ))}
        </div>
      )}

      {/* Content grid */}
      <div className="px-5 pb-3 min-h-[260px] max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
            <span className="ml-2 text-xs text-text-muted">{t("sourcePicker.refreshing")}</span>
          </div>
        ) : activeTab === "cameras" ? (
          cameras.length === 0 ? (
            <p className="text-xs text-text-faint text-center py-12">{t("sourcePicker.noSources")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {cameras.map(cam => (
                <button
                  key={cam.deviceId}
                  onClick={() => setSelectedId(cam.deviceId)}
                  onDoubleClick={() => handleDoubleClick(cam.deviceId)}
                  className={`relative flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                    selectedId === cam.deviceId
                      ? "border-accent-blue ring-2 ring-accent-blue/30 bg-accent-blue/5"
                      : "border-border-subtle hover:border-text-muted bg-bg-primary"
                  }`}
                >
                  <Camera className="w-8 h-8 text-text-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary font-medium truncate">{cam.label}</p>
                    {cam.label.toLowerCase().includes("obs") && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-400">
                        {t("sourcePicker.obsHint")}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )
        ) : filteredSources.length === 0 ? (
          <p className="text-xs text-text-faint text-center py-12">{t("sourcePicker.noSources")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filteredSources.map(src => (
              <button
                key={src.id}
                onClick={() => setSelectedId(src.id)}
                onDoubleClick={() => handleDoubleClick(src.id)}
                className={`relative group rounded-xl border-2 overflow-hidden transition-all ${
                  selectedId === src.id
                    ? "border-accent-blue ring-2 ring-accent-blue/30"
                    : "border-border-subtle hover:border-text-muted"
                }`}
              >
                <img
                  src={src.thumbnail}
                  alt={src.name}
                  className="w-full aspect-video object-cover bg-black"
                  draggable={false}
                />
                <div className="px-2 py-1.5 bg-bg-primary">
                  <p className="text-[11px] text-text-secondary font-medium truncate" title={src.name}>
                    {src.appIcon && (
                      <img
                        src={src.appIcon}
                        alt=""
                        className="inline-block w-3.5 h-3.5 mr-1 -mt-0.5"
                      />
                    )}
                    {src.name}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer buttons */}
      <div className="flex justify-end gap-3 px-5 pb-5 pt-2 border-t border-border-subtle">
        <button
          onClick={handleCancel}
          className="px-4 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
        >
          {t("sourcePicker.cancel")}
        </button>
        <button
          onClick={handleSelect}
          disabled={!selectedId}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
            selectedId
              ? "bg-accent-blue text-white hover:bg-accent-blue/90"
              : "bg-bg-hover text-text-muted cursor-not-allowed opacity-60"
          }`}
        >
          {t("sourcePicker.select")}
        </button>
      </div>
    </dialog>
  );
}
