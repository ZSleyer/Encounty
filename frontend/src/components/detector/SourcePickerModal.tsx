/**
 * SourcePickerModal.tsx — Source picker for browser-native capture.
 *
 * Shows live thumbnails for screens and windows (via Electron desktopCapturer)
 * and live camera previews (via getUserMedia per device).
 * On Wayland + Electron display capture, the modal is skipped entirely and the
 * caller falls through to the native PipeWire/xdg-desktop-portal picker.
 */
import { useState, useEffect, useRef, useCallback, type RefObject } from "react";
import { X, Monitor, AppWindow, Camera, RefreshCw } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

// --- Types -------------------------------------------------------------------

export interface SelectedSource {
  type: "screen" | "window" | "camera";
  sourceId: string;
  label: string;
  /** Pre-acquired camera stream for reuse — avoids double camera activation. */
  stream?: MediaStream;
}

type SourcePickerModalProps = Readonly<{
  sourceType: "browser_display" | "browser_camera";
  onSelect: (source: SelectedSource) => void;
  onClose: () => void;
}>;

interface CameraDevice {
  deviceId: string;
  label: string;
  stream: MediaStream;
}

type Tab = "screens" | "windows" | "cameras";

// Keywords that identify capture cards vs regular webcams
const CAPTURE_CARD_KEYWORDS = [
  "elgato", "cam link", "hd60", "hd 60", "4k60", "4k 60", "game capture",
  "avermedia", "live gamer", "gc", "razer ripsaw", "ripsaw",
  "magewell", "blackmagic", "decklink", "intensity",
  "startech", "j5create", "pengo", "genki shadowcast", "shadowcast",
  "hagibis", "capture card", "video capture",
];

/** Detect whether a device label indicates a capture card rather than a webcam. */
function isCaptureCard(label: string): boolean {
  const lower = label.toLowerCase();
  return CAPTURE_CARD_KEYWORDS.some((kw) => lower.includes(kw));
}

// --- Selection helpers --------------------------------------------------------

/** Stop all camera streams except the one with the given device ID. */
function stopOtherCameraStreams(cameras: CameraDevice[], keepDeviceId: string): void {
  for (const cam of cameras) {
    if (cam.deviceId !== keepDeviceId) {
      cam.stream.getTracks().forEach((t) => t.stop());
    }
  }
}

/** Stop all camera streams unconditionally. */
function stopAllCameraStreams(cameras: CameraDevice[]): void {
  for (const cam of cameras) {
    cam.stream.getTracks().forEach((t) => t.stop());
  }
}

/** Build a SelectedSource from a camera device, stopping other streams. */
function selectCamera(
  cameras: CameraDevice[],
  deviceId: string,
  onSelect: (source: SelectedSource) => void,
  selectedStreamRef?: RefObject<MediaStream | null>,
): boolean {
  const cam = cameras.find((c) => c.deviceId === deviceId);
  if (!cam) return false;
  if (selectedStreamRef) selectedStreamRef.current = cam.stream;
  stopOtherCameraStreams(cameras, deviceId);
  onSelect({ type: "camera", sourceId: cam.deviceId, label: cam.label, stream: cam.stream });
  return true;
}

/** Build a SelectedSource from a capture source, stopping all camera streams. */
function selectCaptureSource(
  captureSources: CaptureSource[],
  cameras: CameraDevice[],
  sourceId: string,
  onSelect: (source: SelectedSource) => void,
): boolean {
  const src = captureSources.find((s) => s.id === sourceId);
  if (!src) return false;
  stopAllCameraStreams(cameras);
  const type = src.id.startsWith("screen:") ? "screen" : "window";
  onSelect({ type, sourceId: src.id, label: src.name });
  return true;
}

/** Open a live preview stream for a single camera device, returning null on failure. */
async function openCameraDevice(device: MediaDeviceInfo): Promise<CameraDevice | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: device.deviceId } },
      audio: false,
    });
    return {
      deviceId: device.deviceId,
      label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
      stream,
    };
  } catch {
    return null;
  }
}

// --- Grid sub-components -----------------------------------------------------

/** Renders the camera device grid, or a "no sources" message when empty. */
function CameraGrid({
  cameras,
  selectedId,
  onSelect,
  onDoubleClick,
  videoRefsMap,
  t,
}: Readonly<{
  cameras: CameraDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  videoRefsMap: React.RefObject<Map<string, HTMLVideoElement>>;
  t: (k: string) => string;
}>) {
  if (cameras.length === 0) {
    return <p className="text-xs text-text-faint text-center py-12">{t("sourcePicker.noSources")}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {cameras.map((cam) => (
        <button
          key={cam.deviceId}
          onClick={() => onSelect(cam.deviceId)}
          onDoubleClick={() => onDoubleClick(cam.deviceId)}
          className={`relative rounded-xl border-2 overflow-hidden transition-all text-left ${
            selectedId === cam.deviceId
              ? "border-accent-blue ring-2 ring-accent-blue/30"
              : "border-border-subtle hover:border-text-muted"
          }`}
        >
          <video
            ref={(el) => {
              if (el) videoRefsMap.current.set(cam.deviceId, el);
              else videoRefsMap.current.delete(cam.deviceId);
            }}
            autoPlay
            playsInline
            muted
            className="w-full aspect-video object-cover bg-black"
          />
          <div className="px-2 py-1.5 bg-bg-primary">
            <p className="text-[11px] text-text-secondary font-medium truncate" title={cam.label}>
              {cam.label}
            </p>
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {isCaptureCard(cam.label) && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400">
                  {t("sourcePicker.captureCardHint")}
                </span>
              )}
              {cam.label.toLowerCase().includes("obs") && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-400">
                  {t("sourcePicker.obsHint")}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Renders the screen/window capture source grid (Electron desktopCapturer). */
function SourceGrid({
  sources,
  selectedId,
  onSelect,
  onDoubleClick,
  t,
}: Readonly<{
  sources: CaptureSource[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  t: (k: string) => string;
}>) {
  if (sources.length === 0) {
    return <p className="text-xs text-text-faint text-center py-12">{t("sourcePicker.noSources")}</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {sources.map((src) => (
        <button
          key={src.id}
          onClick={() => onSelect(src.id)}
          onDoubleClick={() => onDoubleClick(src.id)}
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
  );
}

// --- Component ---------------------------------------------------------------

/** Modal for selecting a browser capture source (screen, window, or camera). */
export function SourcePickerModal({ sourceType, onSelect, onClose }: SourcePickerModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isElectron = !!globalThis.electronAPI;
  const isWayland = globalThis.electronAPI?.isWayland ?? false;

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
  const camerasRef = useRef(cameras);
  camerasRef.current = cameras;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const selectedStreamRef = useRef<MediaStream | null>(null);

  // Track refs for camera video elements
  const videoRefsMap = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Open dialog on mount
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Fetch capture sources (screens + windows) from Electron
  const fetchSources = useCallback(async () => {
    if (!isElectron || sourceType === "browser_camera" || isWayland) return;
    try {
      const sources = await globalThis.electronAPI!.getCaptureSources();
      setCaptureSources(sources);
    } catch {
      setCaptureSources([]);
    }
    setLoading(false);
  }, [isElectron, sourceType, isWayland]);

  // Fetch camera devices with live preview streams
  const fetchCameras = useCallback(async () => {
    if (sourceType !== "browser_camera") return;
    try {
      // Request camera permission once
      if (globalThis.electronAPI?.requestCameraAccess) {
        await globalThis.electronAPI.requestCameraAccess();
      } else {
        // Browser fallback: request a throwaway stream to unlock labels
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        tempStream.getTracks().forEach((t) => t.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");

      // Create a live preview stream for each camera
      const cameraEntries: CameraDevice[] = [];
      for (const device of videoInputs) {
        const entry = await openCameraDevice(device);
        if (entry) cameraEntries.push(entry);
      }
      setCameras(cameraEntries);
    } catch {
      // Permission denied or no cameras
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

  // Cleanup camera streams on unmount — skip the stream handed off to the capture service
  useEffect(() => {
    return () => {
      for (const cam of camerasRef.current) {
        if (cam.stream !== selectedStreamRef.current) {
          cam.stream.getTracks().forEach((t) => t.stop());
        }
      }
    };
  }, []);

  // Attach streams to video elements when cameras change
  useEffect(() => {
    for (const cam of cameras) {
      const videoEl = videoRefsMap.current.get(cam.deviceId);
      if (videoEl && videoEl.srcObject !== cam.stream) {
        videoEl.srcObject = cam.stream;
        videoEl.play().catch(() => {});
      }
    }
  }, [cameras]);

  // Refresh thumbnails every 3 seconds for screens/windows
  useEffect(() => {
    if (sourceType === "browser_camera" || !isElectron || isWayland) return;
    const interval = setInterval(fetchSources, 3000);
    return () => clearInterval(interval);
  }, [sourceType, isElectron, fetchSources, isWayland]);

  // Filter sources by active tab
  const filteredSources = captureSources.filter((s) => {
    if (activeTab === "screens") return s.id.startsWith("screen:");
    if (activeTab === "windows") return !s.id.startsWith("screen:");
    return false;
  });

  // --- Handlers --------------------------------------------------------------

  const handleCancel = () => {
    stopAllCameraStreams(cameras);
    dialogRef.current?.close();
    onClose();
  };

  /** Resolve the selected source and invoke the onSelect callback. */
  const handleSelect = () => {
    if (!selectedId) return;
    if (activeTab === "cameras") {
      selectCamera(cameras, selectedId, onSelect, selectedStreamRef);
    } else {
      selectCaptureSource(captureSources, cameras, selectedId, onSelect);
    }
  };

  /** Handle double-click for immediate selection. */
  const handleDoubleClick = (id: string) => {
    setSelectedId(id);
    setTimeout(() => {
      if (activeTab === "cameras") {
        selectCamera(cameras, id, onSelect, selectedStreamRef);
      } else {
        selectCaptureSource(captureSources, cameras, id, onSelect);
      }
    }, 0);
  };

  // Reset selection when switching tabs
  useEffect(() => {
    setSelectedId(null);
  }, [activeTab]);

  // --- Render ----------------------------------------------------------------

  /** Render the appropriate content grid based on loading state and active tab. */
  const renderContentGrid = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
          <span className="ml-2 text-xs text-text-muted">{t("sourcePicker.refreshing")}</span>
        </div>
      );
    }
    if (activeTab === "cameras") {
      return (
        <CameraGrid
          cameras={cameras}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDoubleClick={handleDoubleClick}
          videoRefsMap={videoRefsMap}
          t={t}
        />
      );
    }
    return (
      <SourceGrid
        sources={filteredSources}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDoubleClick={handleDoubleClick}
        t={t}
      />
    );
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
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
          {availableTabs.map((tab) => (
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
      <div className="px-5 pb-3 min-h-65 max-h-100 overflow-y-auto">
        {renderContentGrid()}
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
