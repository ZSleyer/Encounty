/**
 * SourcePickerModal.tsx — Source picker for screen/window/camera capture.
 *
 * Shows a two-category modal: "Native (fast)" sources fetched from the Go
 * backend (windows, cameras) and "Browser (slow)" sources via Electron
 * desktopCapturer / getUserMedia. Native sources are captured server-side
 * and do not require a MediaStream in the browser.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { X, Monitor, AppWindow, Camera, RefreshCw, Zap, Globe } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { WindowInfo, CameraInfo, DetectorCapabilities } from "../../types";

// --- Types -------------------------------------------------------------------

export interface SelectedSource {
  type: "screen" | "window" | "camera";
  sourceId: string;
  label: string;
  /** Pre-acquired camera stream for reuse — avoids double camera activation. */
  stream?: MediaStream;
}

type SourcePickerModalProps = Readonly<{
  sourceType: "browser_display" | "browser_camera" | "window" | "camera";
  capabilities?: DetectorCapabilities | null;
  onSelect: (source: SelectedSource) => void;
  onClose: () => void;
}>;

interface BrowserCameraDevice {
  deviceId: string;
  label: string;
  stream: MediaStream;
}

type Category = "native" | "browser";
type NativeTab = "native_windows" | "native_cameras";
type BrowserTab = "screens" | "windows" | "cameras";
type Tab = NativeTab | BrowserTab;

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

// --- Native source grid components -------------------------------------------

/** Renders selectable cards for native windows fetched from the backend. */
function NativeWindowGrid({
  windows,
  selectedId,
  onSelect,
  onDoubleClick,
  t,
}: Readonly<{
  windows: WindowInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  t: (k: string) => string;
}>) {
  if (windows.length === 0) {
    return <p className="text-xs text-text-faint text-center py-12">{t("sourcePicker.noSources")}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {windows.map((win) => {
        const id = win.hwnd.toString();
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            onDoubleClick={() => onDoubleClick(id)}
            className={`relative rounded-xl border-2 overflow-hidden transition-all text-left ${
              selectedId === id
                ? "border-accent-blue ring-2 ring-accent-blue/30"
                : "border-border-subtle hover:border-text-muted"
            }`}
          >
            <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
              <AppWindow className="w-8 h-8 text-white/20" />
            </div>
            <div className="px-2 py-1.5 bg-bg-primary">
              <p className="text-[11px] text-text-secondary font-medium truncate" title={win.title}>
                {win.title}
              </p>
              <p className="text-[10px] text-text-muted truncate">
                {win.w}&times;{win.h} &middot; {win.class}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Renders selectable cards for native cameras fetched from the backend. */
function NativeCameraGrid({
  cameras,
  selectedId,
  onSelect,
  onDoubleClick,
  t,
}: Readonly<{
  cameras: CameraInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  t: (k: string) => string;
}>) {
  if (cameras.length === 0) {
    return <p className="text-xs text-text-faint text-center py-12">{t("sourcePicker.noSources")}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {cameras.map((cam) => (
        <button
          key={cam.device_path}
          onClick={() => onSelect(cam.device_path)}
          onDoubleClick={() => onDoubleClick(cam.device_path)}
          className={`relative rounded-xl border-2 overflow-hidden transition-all text-left ${
            selectedId === cam.device_path
              ? "border-accent-blue ring-2 ring-accent-blue/30"
              : "border-border-subtle hover:border-text-muted"
          }`}
        >
          <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
            <Camera className="w-8 h-8 text-white/20" />
          </div>
          <div className="px-2 py-1.5 bg-bg-primary">
            <p className="text-[11px] text-text-secondary font-medium truncate" title={cam.name}>
              {cam.name}
            </p>
            <p className="text-[10px] text-text-muted truncate">
              {cam.driver}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

// --- Browser source grid components ------------------------------------------

/** Renders the browser camera device grid, or a "no sources" message when empty. */
function BrowserCameraGrid({
  cameras,
  selectedId,
  onSelect,
  onDoubleClick,
  videoRefsMap,
  t,
}: Readonly<{
  cameras: BrowserCameraDevice[];
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
      {cameras.map(cam => (
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

/** Renders the Electron screen/window capture source grid. */
function BrowserSourceGrid({
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
      {sources.map(src => (
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

/** Compute the set of browser tabs available given the source type. */
function computeBrowserTabs(isBrowser: boolean, st: string): BrowserTab[] {
  if (!isBrowser) return ["screens", "windows", "cameras"];
  if (st === "browser_camera") return ["cameras"];
  return ["screens", "windows"];
}

/** Build a SelectedSource from a native window selection. */
function buildNativeWindowSource(windows: WindowInfo[], id: string): SelectedSource | null {
  const win = windows.find((w) => w.hwnd.toString() === id);
  if (!win) return null;
  return { type: "window", sourceId: win.hwnd.toString(), label: win.title };
}

/** Build a SelectedSource from a native camera selection. */
function buildNativeCameraSource(cameras: CameraInfo[], id: string): SelectedSource | null {
  const cam = cameras.find((c) => c.device_path === id);
  if (!cam) return null;
  return { type: "camera", sourceId: cam.device_path, label: cam.name };
}

/** Build a SelectedSource from a browser camera selection. */
function buildBrowserCameraSource(cameras: BrowserCameraDevice[], id: string): SelectedSource | null {
  const cam = cameras.find((c) => c.deviceId === id);
  if (!cam) return null;
  return { type: "camera", sourceId: cam.deviceId, label: cam.label, stream: cam.stream };
}

/** Stop all browser camera streams except the one with the given device ID. */
function stopOtherCameraStreams(cameras: BrowserCameraDevice[], keepId: string) {
  for (const cam of cameras) {
    if (cam.deviceId !== keepId) {
      cam.stream.getTracks().forEach((tr) => tr.stop());
    }
  }
}

/** Build a SelectedSource from a browser (Electron) capture source. */
function buildBrowserDisplaySource(sources: CaptureSource[], id: string): SelectedSource | null {
  const src = sources.find((s) => s.id === id);
  if (!src) return null;
  const type = src.id.startsWith("screen:") ? "screen" as const : "window" as const;
  return { type, sourceId: src.id, label: src.name };
}

// --- Component ---------------------------------------------------------------

export function SourcePickerModal({ sourceType, capabilities, onSelect, onClose }: SourcePickerModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isElectron = !!globalThis.electronAPI;
  const isWayland = globalThis.electronAPI?.isWayland ?? false;

  const isNativeSource = sourceType === "window" || sourceType === "camera";
  const isBrowserSource = sourceType === "browser_display" || sourceType === "browser_camera";

  // On Wayland + browser display capture, skip the thumbnail picker entirely and let
  // the caller fall through to the native PipeWire/xdg-desktop-portal picker.
  useEffect(() => {
    if (isWayland && sourceType === "browser_display") {
      onClose();
    }
  }, [isWayland, sourceType, onClose]);

  // --- Category / Tab state --------------------------------------------------

  const [activeCategory, setActiveCategory] = useState<Category>("native");

  const getDefaultTab = (cat: Category): Tab => {
    if (cat === "native") {
      return sourceType === "camera" ? "native_cameras" : "native_windows";
    }
    return sourceType === "browser_camera" ? "cameras" : "screens";
  };

  const [activeTab, setActiveTab] = useState<Tab>(getDefaultTab("native"));

  // Available tabs per category
  const nativeTabs: NativeTab[] = ["native_windows", "native_cameras"];
  const browserTabs: BrowserTab[] = computeBrowserTabs(isBrowserSource, sourceType);

  // --- Native source data ----------------------------------------------------

  const [nativeWindows, setNativeWindows] = useState<WindowInfo[]>([]);
  const [nativeCameras, setNativeCameras] = useState<CameraInfo[]>([]);
  const [nativeLoading, setNativeLoading] = useState(false);

  const fetchNativeSources = useCallback(async () => {
    setNativeLoading(true);
    try {
      const [winRes, camRes] = await Promise.all([
        fetch("/api/detector/windows"),
        fetch("/api/detector/cameras"),
      ]);
      if (winRes.ok) {
        const data = await winRes.json() as WindowInfo[];
        setNativeWindows(Array.isArray(data) ? data : []);
      }
      if (camRes.ok) {
        const data = await camRes.json() as CameraInfo[];
        setNativeCameras(Array.isArray(data) ? data : []);
      }
    } catch {
      // Backend might not support native sources yet
    }
    setNativeLoading(false);
  }, []);

  // --- Browser source data ---------------------------------------------------

  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [browserCameras, setBrowserCameras] = useState<BrowserCameraDevice[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);

  const videoRefsMap = useRef<Map<string, HTMLVideoElement>>(new Map());

  const fetchBrowserSources = useCallback(async () => {
    if (!isElectron || isWayland) return;
    setBrowserLoading(true);
    try {
      const sources = await globalThis.electronAPI!.getCaptureSources();
      setCaptureSources(sources);
    } catch {
      setCaptureSources([]);
    }
    setBrowserLoading(false);
  }, [isElectron, isWayland]);

  const cleanupBrowserCameraStreams = useCallback(() => {
    setBrowserCameras((prev) => {
      for (const cam of prev) {
        cam.stream.getTracks().forEach((tr) => tr.stop());
      }
      return [];
    });
  }, []);

  const fetchBrowserCameras = useCallback(async () => {
    setBrowserLoading(true);
    try {
      if (globalThis.electronAPI?.requestCameraAccess) {
        await globalThis.electronAPI.requestCameraAccess();
      } else {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        tempStream.getTracks().forEach((tr) => tr.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");

      const entries: BrowserCameraDevice[] = [];
      for (const device of videoInputs) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: device.deviceId } },
            audio: false,
          });
          entries.push({
            deviceId: device.deviceId,
            label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
            stream,
          });
        } catch {
          // Skip cameras that fail to open
        }
      }
      setBrowserCameras(entries);
    } catch {
      // Permission denied or no cameras
    }
    setBrowserLoading(false);
  }, []);

  // --- Selected state --------------------------------------------------------

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // --- Lifecycle -------------------------------------------------------------

  // Open dialog on mount
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Fetch native sources on mount
  useEffect(() => {
    fetchNativeSources();
  }, [fetchNativeSources]);

  // Fetch browser sources when switching to browser category
  useEffect(() => {
    if (activeCategory !== "browser") return;
    const currentBrowserTab = activeTab as BrowserTab;
    if (currentBrowserTab === "cameras" && browserCameras.length === 0) {
      fetchBrowserCameras();
    } else if (currentBrowserTab !== "cameras" && captureSources.length === 0) {
      fetchBrowserSources();
    }
  }, [activeCategory, activeTab, browserCameras.length, captureSources.length, fetchBrowserCameras, fetchBrowserSources]);

  // Cleanup browser camera streams on unmount
  useEffect(() => {
    return () => cleanupBrowserCameraStreams();
  }, [cleanupBrowserCameraStreams]);

  // Attach browser camera streams to video elements
  useEffect(() => {
    for (const cam of browserCameras) {
      const videoEl = videoRefsMap.current.get(cam.deviceId);
      if (videoEl && videoEl.srcObject !== cam.stream) {
        videoEl.srcObject = cam.stream;
        videoEl.play().catch(() => {});
      }
    }
  }, [browserCameras]);

  // Refresh browser source thumbnails periodically
  useEffect(() => {
    if (activeCategory !== "browser" || !isElectron || isWayland) return;
    const currentBrowserTab = activeTab as BrowserTab;
    if (currentBrowserTab === "cameras") return;
    const interval = setInterval(fetchBrowserSources, 3000);
    return () => clearInterval(interval);
  }, [activeCategory, activeTab, isElectron, isWayland, fetchBrowserSources]);

  // Filter browser sources by active tab
  const filteredBrowserSources = captureSources.filter(s => {
    if (activeTab === "screens") return s.id.startsWith("screen:");
    if (activeTab === "windows") return !s.id.startsWith("screen:");
    return false;
  });

  // Reset selection when switching tabs
  useEffect(() => {
    setSelectedId(null);
  }, [activeTab]);

  // --- Handlers --------------------------------------------------------------

  const handleCategorySwitch = (cat: Category) => {
    setActiveCategory(cat);
    setActiveTab(getDefaultTab(cat));
    setSelectedId(null);
  };

  const handleCancel = () => {
    for (const cam of browserCameras) {
      cam.stream.getTracks().forEach((tr) => tr.stop());
    }
    dialogRef.current?.close();
    onClose();
  };

  const resolveSelectedSource = (id: string): SelectedSource | null => {
    if (activeCategory === "native") {
      if (activeTab === "native_windows") return buildNativeWindowSource(nativeWindows, id);
      if (activeTab === "native_cameras") return buildNativeCameraSource(nativeCameras, id);
      return null;
    }
    if (activeTab === "cameras") return buildBrowserCameraSource(browserCameras, id);
    return buildBrowserDisplaySource(captureSources, id);
  };

  const handleSelect = () => {
    if (!selectedId) return;
    const source = resolveSelectedSource(selectedId);
    if (!source) return;

    if (activeCategory === "browser" && activeTab === "cameras") {
      stopOtherCameraStreams(browserCameras, selectedId);
    } else {
      cleanupBrowserCameraStreams();
    }
    onSelect(source);
  };

  const handleDoubleClick = (id: string) => {
    setSelectedId(id);
    setTimeout(() => {
      const source = resolveSelectedSource(id);
      if (!source) return;

      if (activeCategory === "browser" && activeTab === "cameras") {
        stopOtherCameraStreams(browserCameras, id);
      } else {
        cleanupBrowserCameraStreams();
      }
      onSelect(source);
    }, 0);
  };

  // --- Render helpers --------------------------------------------------------

  const isLoading = activeCategory === "native" ? nativeLoading : browserLoading;

  /** Render the tab icon for a given tab key. */
  function tabIcon(tab: Tab) {
    switch (tab) {
      case "native_windows": return <AppWindow className="w-3.5 h-3.5" />;
      case "native_cameras": return <Camera className="w-3.5 h-3.5" />;
      case "screens": return <Monitor className="w-3.5 h-3.5" />;
      case "windows": return <AppWindow className="w-3.5 h-3.5" />;
      case "cameras": return <Camera className="w-3.5 h-3.5" />;
    }
  }

  /** Render the tab label for a given tab key. */
  function tabLabel(tab: Tab): string {
    switch (tab) {
      case "native_windows": return t("sourcePicker.windows");
      case "native_cameras": return t("sourcePicker.cameras");
      case "screens": return t("sourcePicker.screens");
      case "windows": return t("sourcePicker.windows");
      case "cameras": return t("sourcePicker.cameras");
    }
  }

  /** Render the content grid for the active tab. */
  function renderContent() {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
          <span className="ml-2 text-xs text-text-muted">{t("sourcePicker.refreshing")}</span>
        </div>
      );
    }

    if (activeCategory === "native") {
      if (activeTab === "native_windows") {
        if (capabilities?.supports_window_capture === false) {
          return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-xs text-text-muted">{t("detector.sourceUnavailable")}</p>
              <p className="text-[10px] text-text-faint mt-1">{t("detector.useInstead")}</p>
            </div>
          );
        }
        return (
          <NativeWindowGrid
            windows={nativeWindows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDoubleClick={handleDoubleClick}
            t={t}
          />
        );
      }
      if (activeTab === "native_cameras" && capabilities?.supports_camera === false) {
        return (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-xs text-text-muted">{t("detector.sourceUnavailable")}</p>
            <p className="text-[10px] text-text-faint mt-1">{t("detector.useInstead")}</p>
          </div>
        );
      }
      return (
        <NativeCameraGrid
          cameras={nativeCameras}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDoubleClick={handleDoubleClick}
          t={t}
        />
      );
    }

    // Browser category
    if (activeTab === "cameras") {
      return (
        <BrowserCameraGrid
          cameras={browserCameras}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDoubleClick={handleDoubleClick}
          videoRefsMap={videoRefsMap}
          t={t}
        />
      );
    }
    return (
      <BrowserSourceGrid
        sources={filteredBrowserSources}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDoubleClick={handleDoubleClick}
        t={t}
      />
    );
  }

  // --- JSX -------------------------------------------------------------------

  const currentTabs = activeCategory === "native" ? nativeTabs : browserTabs;

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

      {/* Category selector (Native / Browser) */}
      <div className="flex gap-2 px-5 pb-3">
        <button
          onClick={() => handleCategorySwitch("native")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            activeCategory === "native"
              ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
              : "bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          {t("sourcePicker.native")}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400">
            {t("sourcePicker.fast")}
          </span>
        </button>
        <button
          onClick={() => handleCategorySwitch("browser")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            activeCategory === "browser"
              ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30"
              : "bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          {t("sourcePicker.browser")}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400">
            {t("sourcePicker.slow")}
          </span>
        </button>
      </div>

      {/* Tabs within the active category */}
      {currentTabs.length > 1 && (
        <div className="flex gap-1 px-5 pb-3">
          {currentTabs.map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedId(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? "bg-accent-blue text-white"
                  : "bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              {tabIcon(tab)}
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      )}

      {/* Content grid */}
      <div className="px-5 pb-3 min-h-65 max-h-100 overflow-y-auto">
        {renderContent()}
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
