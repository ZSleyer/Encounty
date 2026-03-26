import { useRef, useCallback } from "react";
import { OverlaySettings, OverlayElementBase } from "../../types";
import { Overlay } from "../../pages/Overlay";
import type { Pokemon } from "../../types";
import { Guide, useSnapping } from "../../hooks/useSnapping";

type ElementKey = "sprite" | "name" | "title" | "counter";
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface OverlayCanvasProps {
  readonly localSettings: OverlaySettings;
  readonly selectedEl: ElementKey;
  readonly effectiveScale: number;
  readonly showGrid: boolean;
  readonly gridSize: number;
  readonly snapEnabled: boolean;
  readonly guides: Guide[];
  readonly isDragging: boolean;
  readonly altHeld?: boolean;
  readonly effectiveTool: "pointer" | "hand" | "zoom";
  readonly isPanDragging: boolean;
  readonly canvasBg: "transparent" | "white" | "black";
  readonly testTrigger: { element: ElementKey; n: number; reverse?: boolean };
  readonly fakeCount: number | null;
  readonly activePokemon?: Pokemon;
  readonly readOnly?: boolean;
  readonly canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  readonly onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  readonly onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  readonly onMouseUp: () => void;
  readonly onSelectElement: (key: ElementKey) => void;
  readonly onDoubleClickElement?: (key: ElementKey) => void;
  readonly onZoomAtPoint?: (clientX: number, clientY: number, direction: "in" | "out") => void;
  readonly onDragStateChange: (dragging: boolean) => void;
  readonly onGuidesChange: (guides: Guide[]) => void;
  readonly onUpdate: (settings: OverlaySettings) => void;
}

interface UseElementDragOptions {
  readonly elementKey: ElementKey;
  readonly settings: OverlaySettings;
  readonly onUpdate: (s: OverlaySettings) => void;
  readonly canvasScale: number;
  readonly onDragStateChange?: (dragging: boolean) => void;
  readonly onGuidesChange?: (guides: Guide[]) => void;
  readonly snapEnabled?: boolean;
  readonly gridSize?: number;
}

export function useElementDrag({
  elementKey,
  settings,
  onUpdate,
  canvasScale,
  onDragStateChange,
  onGuidesChange,
  snapEnabled,
  gridSize,
}: UseElementDragOptions) {
  const dragging = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizing = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const snapping = useSnapping(settings, snapEnabled ?? false, gridSize ?? 8);

  const getEl = useCallback(
    () => settings[elementKey] as OverlayElementBase,
    [settings, elementKey],
  );
  const setEl = useCallback(
    (patch: Partial<OverlayElementBase>) => {
      onUpdate({
        ...settings,
        [elementKey]: { ...settings[elementKey], ...patch },
      });
    },
    [settings, elementKey, onUpdate],
  );

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = getEl();
      dragging.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: el.x,
        origY: el.y,
      };
      onDragStateChange?.(true);

      const onMove = (me: MouseEvent) => {
        if (!dragging.current) return;
        const dx = (me.clientX - dragging.current.startX) / canvasScale;
        const dy = (me.clientY - dragging.current.startY) / canvasScale;
        const rawX = Math.round(dragging.current.origX + dx);
        const rawY = Math.round(dragging.current.origY + dy);
        const el2 = getEl();
        const snapped = snapping.snap(
          rawX,
          rawY,
          el2.width,
          el2.height,
          me.shiftKey,
        );
        const guides = snapping.getGuides(
          elementKey,
          snapped.x,
          snapped.y,
          el2.width,
          el2.height,
        );
        onGuidesChange?.(guides);
        setEl({ x: snapped.x, y: snapped.y });
      };
      const onUp = () => {
        dragging.current = null;
        onDragStateChange?.(false);
        onGuidesChange?.([]);
        globalThis.removeEventListener("mousemove", onMove);
        globalThis.removeEventListener("mouseup", onUp);
      };
      globalThis.addEventListener("mousemove", onMove);
      globalThis.addEventListener("mouseup", onUp);
    },
    [
      getEl,
      setEl,
      canvasScale,
      snapping,
      elementKey,
      onDragStateChange,
      onGuidesChange,
    ],
  );

  const onResizeStart = useCallback(
    (dir: ResizeDir) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = getEl();
      resizing.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        origX: el.x,
        origY: el.y,
        origW: el.width,
        origH: el.height,
      };
      onDragStateChange?.(true);

      const onMove = (me: MouseEvent) => {
        if (!resizing.current) return;
        const {
          dir: d,
          startX,
          startY,
          origX,
          origY,
          origW,
          origH,
        } = resizing.current;
        const dx = (me.clientX - startX) / canvasScale;
        const dy = (me.clientY - startY) / canvasScale;
        let x = origX,
          y = origY,
          w = origW,
          h = origH;

        if (d.includes("e")) w = Math.max(20, origW + dx);
        if (d.includes("s")) h = Math.max(20, origH + dy);
        if (d.includes("w")) {
          w = Math.max(20, origW - dx);
          x = origX + origW - w;
        }
        if (d.includes("n")) {
          h = Math.max(20, origH - dy);
          y = origY + origH - h;
        }

        // Aspect-ratio lock with Shift
        if (me.shiftKey && origW > 0 && origH > 0) {
          const aspect = origW / origH;
          if (d.includes("e") || d.includes("w")) {
            h = w / aspect;
          } else {
            w = h * aspect;
          }
        }

        setEl({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
        });
      };
      const onUp = () => {
        resizing.current = null;
        onDragStateChange?.(false);
        globalThis.removeEventListener("mousemove", onMove);
        globalThis.removeEventListener("mouseup", onUp);
      };
      globalThis.addEventListener("mousemove", onMove);
      globalThis.addEventListener("mouseup", onUp);
    },
    [getEl, setEl, canvasScale, onDragStateChange],
  );

  return { onDragStart, onResizeStart };
}

export function ResizeHandle({
  dir,
  onResizeStart,
}: Readonly<{
  dir: ResizeDir;
  onResizeStart: (dir: ResizeDir) => (e: React.MouseEvent) => void;
}>) {
  const posStyles: Record<ResizeDir, React.CSSProperties> = {
    n: {
      top: -10,
      left: "50%",
      transform: "translateX(-50%)",
      cursor: "n-resize",
    },
    s: {
      bottom: -10,
      left: "50%",
      transform: "translateX(-50%)",
      cursor: "s-resize",
    },
    e: {
      right: -10,
      top: "50%",
      transform: "translateY(-50%)",
      cursor: "e-resize",
    },
    w: {
      left: -10,
      top: "50%",
      transform: "translateY(-50%)",
      cursor: "w-resize",
    },
    ne: { top: -10, right: -10, cursor: "ne-resize" },
    nw: { top: -10, left: -10, cursor: "nw-resize" },
    se: { bottom: -10, right: -10, cursor: "se-resize" },
    sw: { bottom: -10, left: -10, cursor: "sw-resize" },
  };
  return (
    // Resize handles are mouse-only canvas controls; aria-hidden suppresses S6848
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      aria-hidden="true"
      onMouseDown={onResizeStart(dir)}
      style={{
        position: "absolute",
        width: 20,
        height: 20,
        background: "#3b82f6",
        border: "1px solid white",
        borderRadius: 2,
        zIndex: 100,
        ...posStyles[dir],
      }}
    />
  );
}

export function OverlayCanvas({
  localSettings,
  selectedEl,
  effectiveScale,
  showGrid,
  gridSize,
  guides,
  isDragging,
  effectiveTool,
  isPanDragging,
  canvasBg,
  testTrigger,
  fakeCount,
  activePokemon,
  altHeld,
  readOnly,
  canvasContainerRef,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onSelectElement,
  onDoubleClickElement,
  onZoomAtPoint,
  onDragStateChange,
  onGuidesChange,
  onUpdate,
  snapEnabled,
}: OverlayCanvasProps) {
  const LAYERS: ElementKey[] = ["sprite", "name", "title", "counter"];

  const dragOpts = { settings: localSettings, onUpdate, canvasScale: effectiveScale, onDragStateChange, onGuidesChange, snapEnabled, gridSize };
  const spriteHandlers = useElementDrag({ elementKey: "sprite", ...dragOpts });
  const nameHandlers = useElementDrag({ elementKey: "name", ...dragOpts });
  const titleHandlers = useElementDrag({ elementKey: "title", ...dragOpts });
  const counterHandlers = useElementDrag({ elementKey: "counter", ...dragOpts });

  const handlers: Record<ElementKey, ReturnType<typeof useElementDrag>> = {
    sprite: spriteHandlers,
    name: nameHandlers,
    title: titleHandlers,
    counter: counterHandlers,
  };

  const fakePreviewPokemon: Pokemon | undefined = activePokemon
    ? { ...activePokemon, encounters: fakeCount ?? activePokemon.encounters ?? 0 }
    : undefined;

  const canvasCursor =
    effectiveTool === "hand" ? (isPanDragging ? "grabbing" : "grab") :
    effectiveTool === "zoom" ? (altHeld ? "zoom-out" : "zoom-in") :
    "default";
  const bgColorMap: Record<string, string | undefined> = { white: "#ffffff", black: "#000000" };
  const canvasBgColor = bgColorMap[canvasBg];

  return (
    <div
      ref={canvasContainerRef}
      role="toolbar"
      data-tutorial="canvas"
      tabIndex={0}
      aria-label="Overlay canvas"
      className={`flex-1 rounded-xl border border-border-subtle overflow-auto min-h-0 relative ${canvasBg === "transparent" ? "canvas-checkered" : ""}`}
      style={{
        cursor: canvasCursor,
        backgroundColor: canvasBgColor,
      }}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onKeyDown={(e) => { if (e.key === "Escape") onMouseUp(); }}
    >
      {/* Virtual space — defines the scrollable extent */}
      <div
        style={{
          width: localSettings.canvas_width * effectiveScale + (canvasContainerRef.current?.clientWidth ?? 800) * 0.8,
          height: localSettings.canvas_height * effectiveScale + (canvasContainerRef.current?.clientHeight ?? 600) * 0.8,
          position: "relative",
        }}
      >
        <div
          style={{
            transform: `scale(${effectiveScale})`,
            transformOrigin: "0 0",
            position: "absolute",
            left: (canvasContainerRef.current?.clientWidth ?? 800) * 0.4,
            top: (canvasContainerRef.current?.clientHeight ?? 600) * 0.4,
            width: localSettings.canvas_width,
            height: localSettings.canvas_height,
          }}
        >
          {/* Actual overlay preview */}
          <Overlay
            previewSettings={localSettings}
            previewPokemon={fakePreviewPokemon}
            testTrigger={testTrigger}
          />

          {/* Grid overlay */}
          {showGrid && (
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{
                width: localSettings.canvas_width,
                height: localSettings.canvas_height,
                opacity: 0.15,
              }}
            >
              {Array.from(
                {
                  length: Math.floor(localSettings.canvas_width / gridSize),
                },
                (_, i) => (
                  <line
                    key={`v-${i}`}
                    x1={(i + 1) * gridSize}
                    y1={0}
                    x2={(i + 1) * gridSize}
                    y2={localSettings.canvas_height}
                    stroke="#4a9eff"
                    strokeWidth={0.5}
                  />
                ),
              )}
              {Array.from(
                {
                  length: Math.floor(localSettings.canvas_height / gridSize),
                },
                (_, i) => (
                  <line
                    key={`h-${i}`}
                    x1={0}
                    y1={(i + 1) * gridSize}
                    x2={localSettings.canvas_width}
                    y2={(i + 1) * gridSize}
                    stroke="#4a9eff"
                    strokeWidth={0.5}
                  />
                ),
              )}
            </svg>
          )}

          {/* Smart guidelines */}
          {guides.map((g, i) =>
            g.type === "v" ? (
              <div
                key={`guide-${g.type}-${g.position}-${i}`}
                className="absolute top-0 bottom-0 pointer-events-none border-l border-dashed border-cyan-400"
                style={{ left: g.position, opacity: 0.8 }}
              />
            ) : (
              <div
                key={`guide-${g.type}-${g.position}-${i}`}
                className="absolute left-0 right-0 pointer-events-none border-t border-dashed border-cyan-400"
                style={{ top: g.position, opacity: 0.8 }}
              />
            ),
          )}

          {/* Drag/resize overlays for each element */}
          {!readOnly && LAYERS.filter(key => key !== "title" || (localSettings.title && activePokemon?.title)).map((key) => {
            const el = localSettings[key] as OverlayElementBase;
            if (!el.visible) return null;
            const { onDragStart, onResizeStart } = handlers[key];
            const isSelected = selectedEl === key;
            return (
              <button
                type="button"
                key={key}
                tabIndex={0}
                aria-label={`Element: ${key}`}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectElement(key); } }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onDoubleClickElement?.(key);
                }}
                onMouseDown={(e) => {
                  if (effectiveTool === "hand" || effectiveTool === "zoom") return;
                  onSelectElement(key);
                  onDragStart(e);
                }}
                className="focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1"
                style={{
                  position: "absolute",
                  left: el.x,
                  top: el.y,
                  width: el.width,
                  height: el.height,
                  zIndex: 50 + el.z_index,
                  cursor: effectiveTool === "hand" || effectiveTool === "zoom" ? "inherit" : "move",
                  border: isSelected
                    ? "2px solid #3b82f6"
                    : "2px solid transparent",
                  boxSizing: "border-box",
                  background: "transparent",
                  padding: 0,
                  display: "block",
                }}
              >
                {isSelected && (
                  <>
                    {(
                      [
                        "n",
                        "s",
                        "e",
                        "w",
                        "ne",
                        "nw",
                        "se",
                        "sw",
                      ] as ResizeDir[]
                    ).map((dir) => (
                      <ResizeHandle
                        key={dir}
                        dir={dir}
                        onResizeStart={onResizeStart}
                      />
                    ))}
                  </>
                )}
              </button>
            );
          })}

          {/* Drag tooltip showing dimensions */}
          {isDragging && selectedEl && (
            <div
              className="absolute pointer-events-none bg-black/80 text-white text-[10px] px-2 py-0.5 rounded font-mono"
              style={{
                left: (localSettings[selectedEl] as OverlayElementBase).x + (localSettings[selectedEl] as OverlayElementBase).width / 2 - 20,
                top: Math.max(0, (localSettings[selectedEl] as OverlayElementBase).y - 18),
                zIndex: 200,
              }}
            >
              {(localSettings[selectedEl] as OverlayElementBase).width} ×{" "}
              {(localSettings[selectedEl] as OverlayElementBase).height}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
