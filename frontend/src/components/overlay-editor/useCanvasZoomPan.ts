/**
 * Zoom and pan of the overlay editor canvas. The canvas sits inside a virtual
 * scroll area that is larger than the visible box, so every zoom step has to
 * rewrite the scroll offsets in the same commit that changes the scale. The
 * hook owns that pairing, the scroll container and the pointer handlers that
 * drive it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { OverlaySettings } from "../../types";

/** Free space kept around the canvas inside the virtual scroll area. */
interface Padding {
  readonly x: number;
  readonly y: number;
}

/** Scroll offsets of the canvas container, in pixels. */
interface ScrollOffsets {
  readonly left: number;
  readonly top: number;
}

/**
 * Scroll offsets that keep the canvas point under (mx, my) fixed while the
 * effective scale changes from oldEs to newEs. The wheel handler, the zoom tool
 * and the zoom drag all anchor the same way.
 */
function anchoredScroll(
  container: HTMLDivElement,
  pad: Padding,
  oldEs: number,
  newEs: number,
  mx: number,
  my: number,
): ScrollOffsets {
  const vxBefore = container.scrollLeft + mx;
  const vyBefore = container.scrollTop + my;
  const cx = (vxBefore - pad.x) / oldEs;
  const cy = (vyBefore - pad.y) / oldEs;
  const newVx = cx * newEs + pad.x;
  const newVy = cy * newEs + pad.y;
  return { left: newVx - mx, top: newVy - my };
}

/** Largest scale at which the canvas still fits the preview area, never above 1. */
function fitScaleFor(
  clientWidth: number,
  clientHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const scaleX = clientWidth / canvasWidth;
  const scaleY = clientHeight / canvasHeight;
  return Math.min(scaleX, scaleY, 1);
}

/** Scroll offsets that center the scaled canvas in the preview area. */
function centeredScroll(
  pad: Padding,
  clientWidth: number,
  clientHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  es: number,
): ScrollOffsets {
  const scaledW = canvasWidth * es;
  const scaledH = canvasHeight * es;
  return {
    left: pad.x - (clientWidth - scaledW) / 2,
    top: pad.y - (clientHeight - scaledH) / 2,
  };
}

/**
 * useCanvasZoomPan wires the editor canvas to its scroll container: the fit
 * scale, the cursor-anchored zoom, the hand-tool pan and the pointer position
 * readout the toolbar shows.
 */
export function useCanvasZoomPan({
  localSettings,
  effectiveTool,
}: Readonly<{
  localSettings: OverlaySettings;
  /** Tool currently in effect, spacebar override already applied. */
  effectiveTool: "pointer" | "hand" | "zoom";
}>) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomRef = useRef(1);
  const panDragStart = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [isPanDragging, setIsPanDragging] = useState(false);
  const zoomDragStart = useRef<{
    clientX: number;
    zoom: number;
    anchorMx: number;
    anchorMy: number;
  } | null>(null);
  const [isZoomDragging, setIsZoomDragging] = useState(false);

  // Padding around canvas in the virtual scroll area
  const getPadding = useCallback(() => {
    const c = canvasContainerRef.current;
    if (!c) return { x: 200, y: 200 };
    return { x: c.clientWidth * 0.4, y: c.clientHeight * 0.4 };
  }, []);

  // Keep zoomRef in sync
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Compute scale to fit canvas in the preview area + center it initially. The
  // zoom of the render this effect last ran in is deliberately kept out of the
  // dependencies: a resize recenters at the scale the user was looking at.
  const hasInitialCentered = useRef(false);
  useEffect(() => {
    const updateScale = () => {
      if (!canvasContainerRef.current) return;
      const { clientWidth, clientHeight } = canvasContainerRef.current;
      const scale = fitScaleFor(
        clientWidth,
        clientHeight,
        localSettings.canvas_width,
        localSettings.canvas_height,
      );
      setCanvasScale(scale);
      // Center the canvas via pending scroll (applied after DOM update by useLayoutEffect)
      const pad = getPadding();
      const es = scale * zoom;
      pendingScroll.current = centeredScroll(
        pad,
        clientWidth,
        clientHeight,
        localSettings.canvas_width,
        localSettings.canvas_height,
        es,
      );
    };
    updateScale();
    if (!hasInitialCentered.current) hasInitialCentered.current = true;
    globalThis.addEventListener("resize", updateScale);
    return () => globalThis.removeEventListener("resize", updateScale);
  }, [localSettings.canvas_width, localSettings.canvas_height, getPadding]);

  // Apply pending scroll position after DOM update (zoom changes virtual size)
  useLayoutEffect(() => {
    if (pendingScroll.current && canvasContainerRef.current) {
      canvasContainerRef.current.scrollLeft = pendingScroll.current.left;
      canvasContainerRef.current.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  });

  // Scroll to zoom (anchored to cursor position)
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoomRef.current;
      const newZoom = Math.min(4, Math.max(0.1, oldZoom - e.deltaY * 0.001));
      if (newZoom === oldZoom) return;

      // Schedule scroll adjustment after render
      pendingScroll.current = anchoredScroll(
        container,
        getPadding(),
        canvasScale * oldZoom,
        canvasScale * newZoom,
        mx,
        my,
      );
      setZoom(newZoom);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [canvasScale, getPadding]);

  const effectiveScale = canvasScale * zoom;

  // Track mouse position over canvas (scroll-aware)
  const handleCanvasMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const pad = getPadding();
    const vx = container.scrollLeft + rawX - pad.x;
    const vy = container.scrollTop + rawY - pad.y;
    const x = Math.round(vx / effectiveScale);
    const y = Math.round(vy / effectiveScale);
    setMousePos({ x, y });

    // Zoom drag: smooth zoom by horizontal mouse movement
    if (isZoomDragging && zoomDragStart.current) {
      const dx = e.clientX - zoomDragStart.current.clientX;
      const newZoom = Math.min(
        4,
        Math.max(0.1, zoomDragStart.current.zoom * Math.pow(2, dx / 200)),
      );
      // Re-anchor scroll so the original click point stays fixed
      const anchor = zoomDragStart.current;
      pendingScroll.current = anchoredScroll(
        container,
        getPadding(),
        canvasScale * zoomRef.current,
        canvasScale * newZoom,
        anchor.anchorMx,
        anchor.anchorMy,
      );
      setZoom(newZoom);
      return;
    }

    // Pan dragging via scroll
    if (isPanDragging && panDragStart.current) {
      container.scrollLeft = panDragStart.current.sl - (e.clientX - panDragStart.current.x);
      container.scrollTop = panDragStart.current.st - (e.clientY - panDragStart.current.y);
    }
  };

  const handleCanvasMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (effectiveTool === "zoom") {
      e.preventDefault();
      const container = canvasContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      zoomDragStart.current = {
        clientX: e.clientX,
        zoom: zoomRef.current,
        anchorMx: e.clientX - rect.left,
        anchorMy: e.clientY - rect.top,
      };
      setIsZoomDragging(true);
      return;
    }
    if (effectiveTool === "hand") {
      e.preventDefault();
      const container = canvasContainerRef.current;
      if (!container) return;
      setIsPanDragging(true);
      panDragStart.current = {
        x: e.clientX,
        y: e.clientY,
        sl: container.scrollLeft,
        st: container.scrollTop,
      };
    }
  };

  const handleCanvasMouseUp = () => {
    if (isZoomDragging) {
      setIsZoomDragging(false);
      zoomDragStart.current = null;
    }
    if (isPanDragging) {
      setIsPanDragging(false);
      panDragStart.current = null;
    }
  };

  /** Zoom towards/away from a specific screen point (for zoom tool clicks). */
  const handleZoomAtPoint = useCallback(
    (clientX: number, clientY: number, direction: "in" | "out") => {
      const container = canvasContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const oldZoom = zoomRef.current;
      const factor = direction === "in" ? 1.5 : 1 / 1.5;
      const newZoom = Math.min(4, Math.max(0.1, oldZoom * factor));
      if (newZoom === oldZoom) return;

      pendingScroll.current = anchoredScroll(
        container,
        getPadding(),
        canvasScale * oldZoom,
        canvasScale * newZoom,
        mx,
        my,
      );
      setZoom(newZoom);
    },
    [canvasScale, getPadding],
  );

  // Fit-to-view: reset zoom and center canvas via scroll
  const fitToView = () => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const { clientWidth, clientHeight } = container;
    const fitScale = fitScaleFor(
      clientWidth,
      clientHeight,
      localSettings.canvas_width,
      localSettings.canvas_height,
    );
    setZoom(1);
    setCanvasScale(fitScale);
    // Center via scroll after render
    const pad = getPadding();
    pendingScroll.current = centeredScroll(
      pad,
      clientWidth,
      clientHeight,
      localSettings.canvas_width,
      localSettings.canvas_height,
      fitScale,
    );
  };

  return {
    canvasContainerRef,
    zoom,
    effectiveScale,
    isPanDragging,
    mousePos,
    handleCanvasMouseMove,
    handleCanvasMouseDown,
    handleCanvasMouseUp,
    handleZoomAtPoint,
    fitToView,
  };
}
