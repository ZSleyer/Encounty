/**
 * SourcePickerModal.tsx — Source picker for native capture via the Rust sidecar.
 *
 * Displays three tabs (Screens, Windows, Cameras) populated from the backend
 * API. Each source card shows a thumbnail fetched via the sidecar's
 * capture_frame endpoint when the card is visible.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { X, Monitor, AppWindow, Camera, RefreshCw, ImageOff } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";
import { SourceInfo, DetectorCapabilities } from "../../types";

// --- Types -------------------------------------------------------------------

export interface SelectedSource {
  type: "screen" | "window" | "camera";
  sourceId: string;
  label: string;
}

type SourcePickerModalProps = Readonly<{
  sourceType: "screen" | "window" | "camera";
  capabilities?: DetectorCapabilities | null;
  onSelect: (source: SelectedSource) => void;
  onClose: () => void;
}>;

type Tab = "screens" | "windows" | "cameras";

// --- Thumbnail component -----------------------------------------------------

/** Lazily loads a JPEG thumbnail from the sidecar capture_frame endpoint. */
function SourceThumbnail({
  sourceType,
  sourceId,
  fallbackIcon,
}: Readonly<{
  sourceType: string;
  sourceId: string;
  fallbackIcon: React.ReactNode;
}>) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setSrc(null);
    setFailed(false);

    const url = apiUrl(
      `/api/detector/source/thumbnail?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}&w=320`,
    );

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("thumbnail fetch failed");
        return res.blob();
      })
      .then((blob) => {
        if (!mountedRef.current) return;
        setSrc(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (mountedRef.current) setFailed(true);
      });

    return () => {
      mountedRef.current = false;
    };
  }, [sourceType, sourceId]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  if (failed || !src) {
    return (
      <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
        {failed ? (
          <ImageOff className="w-6 h-6 text-white/15" />
        ) : (
          <RefreshCw className="w-5 h-5 text-white/20 animate-spin" />
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="Source preview"
      className="w-full aspect-video object-cover bg-black/40"
      draggable={false}
    />
  );
}

// --- Source card component ----------------------------------------------------

/** Generic card that wraps a thumbnail and label for any source type. */
function SourceCard({
  id,
  selected,
  sourceType,
  title,
  subtitle,
  fallbackIcon,
  onClick,
  onDoubleClick,
}: Readonly<{
  id: string;
  selected: boolean;
  sourceType: string;
  title: string;
  subtitle: string;
  fallbackIcon: React.ReactNode;
  onClick: () => void;
  onDoubleClick: () => void;
}>) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`relative rounded-xl border-2 overflow-hidden transition-all text-left ${
        selected
          ? "border-accent-blue ring-2 ring-accent-blue/30"
          : "border-border-subtle hover:border-text-muted"
      }`}
    >
      <SourceThumbnail
        sourceType={sourceType}
        sourceId={id}
        fallbackIcon={fallbackIcon}
      />
      <div className="px-2 py-1.5 bg-bg-primary">
        <p className="text-[11px] text-text-secondary font-medium truncate" title={title}>
          {title}
        </p>
        <p className="text-[10px] text-text-muted truncate">
          {subtitle}
        </p>
      </div>
    </button>
  );
}

// --- Grid components ---------------------------------------------------------

/** Renders selectable cards for screens fetched from the sidecar. */
function ScreenGrid({
  screens,
  selectedId,
  onSelect,
  onDoubleClick,
  t,
}: Readonly<{
  screens: SourceInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  t: (k: string) => string;
}>) {
  if (screens.length === 0) {
    return <p className="text-xs text-text-faint text-center py-12">{t("sourcePicker.noSources")}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {screens.map((s) => (
        <SourceCard
          key={s.id}
          id={s.id}
          selected={selectedId === s.id}
          sourceType="screen"
          title={s.title || `Screen ${s.id}`}
          subtitle={s.w && s.h ? `${s.w}\u00d7${s.h}` : ""}
          fallbackIcon={<Monitor className="w-8 h-8 text-white/20" />}
          onClick={() => onSelect(s.id)}
          onDoubleClick={() => onDoubleClick(s.id)}
        />
      ))}
    </div>
  );
}

/** Renders selectable cards for native windows fetched from the backend. */
function WindowGrid({
  windows,
  selectedId,
  onSelect,
  onDoubleClick,
  t,
}: Readonly<{
  windows: SourceInfo[];
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
      {windows.map((win) => (
        <SourceCard
          key={win.id}
          id={win.id}
          selected={selectedId === win.id}
          sourceType="window"
          title={win.title || win.id}
          subtitle={win.w && win.h ? `${win.w}\u00d7${win.h}` : ""}
          fallbackIcon={<AppWindow className="w-8 h-8 text-white/20" />}
          onClick={() => onSelect(win.id)}
          onDoubleClick={() => onDoubleClick(win.id)}
        />
      ))}
    </div>
  );
}

/** Renders selectable cards for native cameras fetched from the backend. */
function CameraGrid({
  cameras,
  selectedId,
  onSelect,
  onDoubleClick,
  t,
}: Readonly<{
  cameras: SourceInfo[];
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
        <SourceCard
          key={cam.id}
          id={cam.id}
          selected={selectedId === cam.id}
          sourceType="camera"
          title={cam.title || cam.id}
          subtitle={cam.w && cam.h ? `${cam.w}\u00d7${cam.h}` : ""}
          fallbackIcon={<Camera className="w-8 h-8 text-white/20" />}
          onClick={() => onSelect(cam.id)}
          onDoubleClick={() => onDoubleClick(cam.id)}
        />
      ))}
    </div>
  );
}

// --- Helpers -----------------------------------------------------------------

/** Build a SelectedSource from a screen selection. */
function buildScreenSource(screens: SourceInfo[], id: string): SelectedSource | null {
  const s = screens.find((sc) => sc.id === id);
  if (!s) return null;
  return { type: "screen", sourceId: s.id, label: s.title || `Screen ${s.id}` };
}

/** Build a SelectedSource from a native window selection. */
function buildWindowSource(windows: SourceInfo[], id: string): SelectedSource | null {
  const win = windows.find((w) => w.id === id);
  if (!win) return null;
  return { type: "window", sourceId: win.id, label: win.title || win.id };
}

/** Build a SelectedSource from a native camera selection. */
function buildCameraSource(cameras: SourceInfo[], id: string): SelectedSource | null {
  const cam = cameras.find((c) => c.id === id);
  if (!cam) return null;
  return { type: "camera", sourceId: cam.id, label: cam.title || cam.id };
}

/** Map source type to initial tab. */
function sourceTypeToTab(sourceType: string): Tab {
  if (sourceType === "camera") return "cameras";
  if (sourceType === "screen" || sourceType === "screen_region") return "screens";
  return "windows";
}

// --- Component ---------------------------------------------------------------

/** Modal for selecting a native capture source (screen, window, or camera). */
export function SourcePickerModal({ sourceType, capabilities, onSelect, onClose }: SourcePickerModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // --- Tab state -------------------------------------------------------------

  const [activeTab, setActiveTab] = useState<Tab>(() => sourceTypeToTab(sourceType));

  // --- Source data -----------------------------------------------------------

  const [screens, setScreens] = useState<SourceInfo[]>([]);
  const [nativeWindows, setNativeWindows] = useState<SourceInfo[]>([]);
  const [nativeCameras, setNativeCameras] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const [screenRes, winRes, camRes] = await Promise.all([
        fetch(apiUrl("/api/detector/screens")),
        fetch(apiUrl("/api/detector/windows")),
        fetch(apiUrl("/api/detector/cameras")),
      ]);
      if (screenRes.ok) {
        const data = await screenRes.json() as SourceInfo[];
        setScreens(Array.isArray(data) ? data : []);
      }
      if (winRes.ok) {
        const data = await winRes.json() as SourceInfo[];
        setNativeWindows(Array.isArray(data) ? data : []);
      }
      if (camRes.ok) {
        const data = await camRes.json() as SourceInfo[];
        setNativeCameras(Array.isArray(data) ? data : []);
      }
    } catch {
      // Backend might not be reachable
    }
    setLoading(false);
  }, []);

  // --- Selected state --------------------------------------------------------

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // --- Lifecycle -------------------------------------------------------------

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    setSelectedId(null);
  }, [activeTab]);

  // --- Handlers --------------------------------------------------------------

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  const resolveSelectedSource = useCallback(
    (id: string): SelectedSource | null => {
      if (activeTab === "screens") return buildScreenSource(screens, id);
      if (activeTab === "windows") return buildWindowSource(nativeWindows, id);
      if (activeTab === "cameras") return buildCameraSource(nativeCameras, id);
      return null;
    },
    [activeTab, screens, nativeWindows, nativeCameras],
  );

  const handleSelect = () => {
    if (!selectedId) return;
    const source = resolveSelectedSource(selectedId);
    if (!source) return;
    onSelect(source);
  };

  const handleDoubleClick = useCallback(
    (id: string) => {
      setSelectedId(id);
      // Resolve in next tick so selectedId state is consistent
      setTimeout(() => {
        const source = resolveSelectedSource(id);
        if (source) onSelect(source);
      }, 0);
    },
    [resolveSelectedSource, onSelect],
  );

  // --- Render helpers --------------------------------------------------------

  /** Render the tab icon for a given tab key. */
  function tabIcon(tab: Tab) {
    switch (tab) {
      case "screens": return <Monitor className="w-3.5 h-3.5" />;
      case "windows": return <AppWindow className="w-3.5 h-3.5" />;
      case "cameras": return <Camera className="w-3.5 h-3.5" />;
    }
  }

  /** Render the tab label for a given tab key. */
  function tabLabel(tab: Tab): string {
    switch (tab) {
      case "screens": return t("sourcePicker.screens");
      case "windows": return t("sourcePicker.windows");
      case "cameras": return t("sourcePicker.cameras");
    }
  }

  /** Check whether the active tab's source type is unsupported. */
  function isTabUnsupported(): boolean {
    if (!capabilities) return false;
    if (activeTab === "screens" && !capabilities.supports_screen_capture && !capabilities.sidecar_available) return true;
    if (activeTab === "windows" && !capabilities.supports_window_capture && !capabilities.sidecar_supports_window_capture) return true;
    if (activeTab === "cameras" && !capabilities.supports_camera && !capabilities.sidecar_available) return true;
    return false;
  }

  /** Render the content grid for the active tab. */
  function renderContent() {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
          <span className="ml-2 text-xs text-text-muted">{t("sourcePicker.refreshing")}</span>
        </div>
      );
    }

    if (isTabUnsupported()) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-xs text-text-muted">{t("detector.sourceUnavailable")}</p>
          <p className="text-[10px] text-text-faint mt-1">{t("detector.useInstead")}</p>
        </div>
      );
    }

    if (activeTab === "screens") {
      return (
        <ScreenGrid
          screens={screens}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDoubleClick={handleDoubleClick}
          t={t}
        />
      );
    }

    if (activeTab === "windows") {
      return (
        <WindowGrid
          windows={nativeWindows}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDoubleClick={handleDoubleClick}
          t={t}
        />
      );
    }

    return (
      <CameraGrid
        cameras={nativeCameras}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDoubleClick={handleDoubleClick}
        t={t}
      />
    );
  }

  // --- JSX -------------------------------------------------------------------

  const tabs: Tab[] = ["screens", "windows", "cameras"];

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
      <div className="flex gap-1 px-5 pb-3">
        {tabs.map(tab => (
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
