/**
 * RegionPicker.tsx — Full-screen modal for selecting a screen region.
 *
 * Fetches a desktop screenshot from GET /api/detector/screenshot, displays it
 * scaled to fit the viewport, and lets the user drag a selection rectangle
 * over it. On confirm, the selection is translated from display coordinates
 * back to native screen coordinates before calling onConfirm.
 *
 * Intended to be rendered inside a React portal at the root of the document
 * so it covers the entire viewport as a fixed overlay.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { X, Check, RefreshCw } from "lucide-react";
import { DetectorRect } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";

// ── Props ────────────────────────────────────────────────────────────────────

/** Props for RegionPicker. */
export type RegionPickerProps = Readonly<{
  /** Called with the selected rectangle in native screen coordinates. */
  onConfirm: (rect: DetectorRect) => void;
  /** Called when the user cancels without selecting. */
  onCancel: () => void;
}>;

// ── Internal types ───────────────────────────────────────────────────────────

interface RawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * RegionPicker — full-screen screenshot overlay that lets the user drag-select
 * a rectangular region and returns the selection in native screen coordinates.
 */
export function RegionPicker({ onConfirm, onCancel }: RegionPickerProps) {
  const { t } = useI18n();

  // Screenshot blob URL loaded from the server.
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // The img element reference — used to read natural/rendered dimensions.
  const imgRef = useRef<HTMLImageElement>(null);

  // Container div reference for computing mouse positions.
  const containerRef = useRef<HTMLButtonElement>(null);

  // Drag state (in display space, relative to container).
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [selection, setSelection] = useState<RawRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Screenshot fetch ─────────────────────────────────────────────────────

  const fetchScreenshot = useCallback(async () => {
    // Revoke previous blob URL to avoid memory leaks.
    if (screenshotUrl) {
      URL.revokeObjectURL(screenshotUrl);
    }
    setLoading(true);
    setLoadError(false);
    setSelection(null);
    setDragStart(null);
    try {
      const res = await fetch(apiUrl("/api/detector/screenshot"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setScreenshotUrl(URL.createObjectURL(blob));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount.
  useEffect(() => {
    fetchScreenshot();
    return () => {
      // Clean up blob URL on unmount.
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Coordinate helpers ───────────────────────────────────────────────────

  /**
   * Given a MouseEvent, returns position relative to the container div
   * (not the page), clamped to the container bounds.
   */
  const relativePos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    };
  };

  /**
   * Computes the letterbox offset of the <img> element within its container
   * when rendered with object-fit: contain.
   *
   * Returns { offsetX, offsetY, renderW, renderH } — all in display pixels.
   */
  const getImageLayout = (): {
    offsetX: number;
    offsetY: number;
    renderW: number;
    renderH: number;
  } | null => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return null;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (!natW || !natH) return null;

    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    const scaleX = containerW / natW;
    const scaleY = containerH / natH;
    const scale = Math.min(scaleX, scaleY);

    const renderW = natW * scale;
    const renderH = natH * scale;
    const offsetX = (containerW - renderW) / 2;
    const offsetY = (containerH - renderH) / 2;

    return { offsetX, offsetY, renderW, renderH };
  };

  /**
   * Converts a point in container-relative display coordinates to native
   * screen coordinates using the image's scale and letterbox offset.
   */
  const toScreenCoords = (
    displayX: number,
    displayY: number,
    layout: { offsetX: number; offsetY: number; renderW: number; renderH: number },
  ): { x: number; y: number } => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const scaleX = natW / layout.renderW;
    const scaleY = natH / layout.renderH;
    return {
      x: Math.round((displayX - layout.offsetX) * scaleX),
      y: Math.round((displayY - layout.offsetY) * scaleY),
    };
  };

  // ── Mouse event handlers ─────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pos = relativePos(e);
    setDragStart(pos);
    setSelection({ x: pos.x, y: pos.y, w: 0, h: 0 });
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart) return;
    const pos = relativePos(e);
    setSelection({
      x: dragStart.x,
      y: dragStart.y,
      w: pos.x - dragStart.x,
      h: pos.y - dragStart.y,
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart) return;
    const pos = relativePos(e);
    // Normalize: ensure w and h are positive.
    const rawW = pos.x - dragStart.x;
    const rawH = pos.y - dragStart.y;
    const normX = rawW >= 0 ? dragStart.x : pos.x;
    const normY = rawH >= 0 ? dragStart.y : pos.y;
    setSelection({
      x: normX,
      y: normY,
      w: Math.abs(rawW),
      h: Math.abs(rawH),
    });
    setIsDragging(false);
  };

  // ── Confirm handler ──────────────────────────────────────────────────────

  const handleConfirm = () => {
    if (!selection) return;
    const layout = getImageLayout();
    if (!layout) return;

    // Normalize display selection (in case w/h are still negative from drag).
    const dispX = selection.w >= 0 ? selection.x : selection.x + selection.w;
    const dispY = selection.h >= 0 ? selection.y : selection.y + selection.h;
    const dispW = Math.abs(selection.w);
    const dispH = Math.abs(selection.h);

    const topLeft = toScreenCoords(dispX, dispY, layout);
    const bottomRight = toScreenCoords(dispX + dispW, dispY + dispH, layout);

    onConfirm({
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
    });
  };

  const hasSelection =
    selection !== null &&
    Math.abs(selection.w) > 4 &&
    Math.abs(selection.h) > 4;

  // ── Selection overlay style ──────────────────────────────────────────────

  /**
   * Compute normalized CSS position for the selection rectangle overlay.
   * Handles both positive and negative w/h from mid-drag.
   */
  const selectionStyle = (): React.CSSProperties => {
    if (!selection) return { display: "none" };
    const left = selection.w >= 0 ? selection.x : selection.x + selection.w;
    const top = selection.h >= 0 ? selection.y : selection.y + selection.h;
    const width = Math.abs(selection.w);
    const height = Math.abs(selection.h);
    return {
      position: "absolute",
      left,
      top,
      width,
      height,
      pointerEvents: "none",
    };
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* ── Top bar: instructions + buttons ─────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 2xl:px-5 2xl:py-4 bg-bg-card/80 backdrop-blur-sm border-b border-border-subtle shrink-0">
        <p className="text-sm 2xl:text-base text-text-secondary">
          {t("regionPicker.instruction")}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchScreenshot}
            className="flex items-center gap-1.5 px-3 py-1.5 2xl:px-4 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-medium bg-bg-secondary border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-blue/30 transition-colors"
            title={t("regionPicker.reload")}
          >
            <RefreshCw className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
            {t("regionPicker.reload")}
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 2xl:px-4 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-medium bg-bg-secondary border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
          >
            <X className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
            {t("regionPicker.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!hasSelection}
            className="flex items-center gap-1.5 px-3 py-1.5 2xl:px-4 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-semibold bg-accent-blue hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
            {t("regionPicker.confirm")}
          </button>
        </div>
      </div>

      {/* ── Screenshot area ──────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {loadError && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <p className="text-text-muted text-sm 2xl:text-base">
              {t("regionPicker.loadError")}
            </p>
            <button
              onClick={fetchScreenshot}
              className="px-4 py-2 2xl:px-5 2xl:py-2.5 rounded-lg text-sm 2xl:text-base bg-accent-blue hover:bg-blue-500 text-white font-medium transition-colors"
            >
              {t("regionPicker.reload")}
            </button>
          </div>
        )}

        {screenshotUrl && !loading && (
          <>
            {/* Screenshot image — fills available space, preserves aspect ratio */}
            <img
              ref={imgRef}
              src={screenshotUrl}
              alt="desktop screenshot"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
              draggable={false}
            />

            {/* Transparent drag overlay — captures all mouse events */}
            <button
              type="button"
              ref={containerRef}
              aria-label="Region selection area"
              style={{ all: "unset", display: "block", position: "absolute", inset: 0, cursor: "crosshair" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {/* Selection rectangle */}
              {selection && (
                <div
                  style={selectionStyle()}
                  className="border-2 border-accent-blue bg-accent-blue/20 rounded-sm"
                />
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
