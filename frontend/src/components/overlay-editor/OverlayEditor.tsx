/**
 * Overlay editor shell: owns the settings being edited, the undo history, the
 * keyboard shortcuts and the editor modals, and arranges the toolbar, the
 * canvas, the property panel and the layers list around them.
 */
import { useState, useEffect, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { EditorTutorial, type EditorTutorialModal } from "./EditorTutorial";
import { OverlaySettings, OverlayElementBase, GradientStop } from "../../types";
import type { Pokemon } from "../../types";
import { useHistory } from "../../hooks/useHistory";
import { Guide } from "../../hooks/useSnapping";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { ColorPickerModal } from "./controls/ColorPickerModal";
import { GradientEditorModal } from "./controls/GradientEditorModal";
import { ShadowEditorModal, type ShadowConfirmParams } from "./controls/ShadowEditorModal";
import { OutlineEditorModal } from "./controls/OutlineEditorModal";
import { TextColorEditorModal } from "./controls/TextColorEditorModal";
import { OverlayCanvas } from "./OverlayCanvas";
import { OverlayPropertyPanel, type OpenOutlineEditorParams } from "./OverlayPropertyPanel";
import { VerticalToolbar } from "./VerticalToolbar";
import { ConfirmModal } from "../shared/ConfirmModal";
import { TemplatePickerModal } from "./TemplatePickerModal";
import { LayersPanel } from "./LayersPanel";
import { fillMissingElements } from "./overlayMigration";
import { useCanvasZoomPan } from "./useCanvasZoomPan";
import { deleteBackgroundImage, pickImageFile, uploadBackgroundImage } from "./backgroundUpload";
import { buildDefaultOverlaySettings, type OverlayTemplate } from "./overlayTemplates";
import { apiUrl } from "../../utils/api";
import { useSplitPane } from "../../hooks/useSplitPane";
import { ELEMENT_KEYS, type ElementKey } from "../../utils/overlayElements";

interface Props {
  settings: OverlaySettings;
  onUpdate: (settings: OverlaySettings) => void;
  activePokemon?: Pokemon;
  /** All tracked Pokemon, so the preview can derive phase, total counter and total timer. */
  previewPokemonList?: Pokemon[];
  overlayTargetId?: string;
  readOnly?: boolean;
  compact?: boolean;
}

/** Callback slot for the tutorial's dialog copies, which must not write anything. */
const NOOP = () => {};

/** Height of the properties panel on a fresh install and after a layout reset. */
const DEFAULT_SPLIT_PX = 500;

/** Smallest height the properties panel above the divider may be dragged to. */
const MIN_SPLIT_PX = 100;

/** Height of the divider between the two panes (h-6). */
const DIVIDER_PX = 24;

/**
 * Height the layers list is kept at while there is room for it. On columns too
 * short to grant it, the two panes split the available space evenly instead.
 */
const MIN_LAYERS_PX = 140;

// Re-exported from its own module so callers that know the editor keep finding
// the hint next to it.

/**
 * OverlayEditor is the editing surface of an overlay: toolbar, canvas preview,
 * property panel and layers list around one settings object.
 */
export function OverlayEditor({
  settings,
  onUpdate,
  activePokemon,
  previewPokemonList,
  overlayTargetId: _overlayTargetId,
  readOnly,
  compact,
}: Readonly<Props>) {
  const { t } = useI18n();
  const { push } = useToast();
  const [localSettings, setLocalSettings] = useState<OverlaySettings>(() =>
    fillMissingElements(settings, t),
  );
  const [selectedEl, setSelectedEl] = useState<ElementKey>("sprite");
  const [testTrigger, setTestTrigger] = useState<{
    element: ElementKey;
    n: number;
    reverse?: boolean;
  }>({ element: "counter", n: 0 });

  // Toolbar state
  const [showGrid, setShowGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [gridSize, setGridSize] = useState(16);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Zoom + Pan (Phase 4), scroll-based. The scroll arithmetic itself lives in
  // useCanvasZoomPan; only the tool selection is kept here, because the
  // keyboard shortcuts below write it.
  const [activeTool, setActiveTool] = useState<"pointer" | "hand" | "zoom">("pointer");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);

  // Right panel split: draggable divider between properties and layers. The
  // properties pane starts at the very top of the column, so no content offset
  // is measured here.
  const {
    size: propertiesHeight,
    containerRef: rightColRef,
    startDrag: startDividerDrag,
    handleKeyDown: handleDividerKeyDown,
    reset: resetEditorSplit,
  } = useSplitPane({
    storageKey: "encounty_editor_split",
    defaultSizePx: DEFAULT_SPLIT_PX,
    minSizePx: MIN_SPLIT_PX,
    reservedPx: DIVIDER_PX,
    minReservePx: MIN_LAYERS_PX,
  });

  // Tutorial
  const [showTutorial, setShowTutorial] = useState(false);
  // Dialog the current walkthrough step points into. It is a separate state
  // from the editor's own modals on purpose: the copy opened here gets no
  // callback that could write a setting.
  const [tutorialModal, setTutorialModal] = useState<EditorTutorialModal | null>(null);

  // Template picker: the picked template waits in pendingTemplate until the
  // user confirms, because applying it discards the current layout.
  const [showTemplates, setShowTemplates] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<OverlayTemplate | null>(null);

  // Canvas background for testing (transparent = checkered, white, black)
  const [canvasBg, setCanvasBg] = useState<"transparent" | "white" | "black">("transparent");

  const bgPreviewUrl = localSettings.background_image
    ? apiUrl(`/api/backgrounds/${localSettings.background_image}`)
    : "";

  const effectiveTool = spaceHeld ? "hand" : activeTool;

  // Background image upload state
  const [bgUploading, setBgUploading] = useState(false);

  const fireTest = (element: ElementKey, reverse = false) =>
    setTestTrigger({ element, n: Date.now(), reverse });

  // Local fake counter, isolated from live OBS overlay
  const [fakeCount, setFakeCount] = useState<number | null>(null);
  useEffect(() => {
    setFakeCount(null);
  }, [activePokemon?.id]);
  const currentCount = fakeCount ?? activePokemon?.encounters ?? 0;

  // total_timer is deliberately absent: like the plain timer it only has an
  // idle animation, so there is no trigger channel to fire.
  const testIncrement = () => {
    setFakeCount(currentCount + 1);
    fireTest("counter");
    fireTest("sprite");
    fireTest("name");
    fireTest("title");
    fireTest("odds");
    fireTest("phase");
    fireTest("total_counter");
  };
  const testDecrement = () => {
    if (currentCount > 0) {
      setFakeCount(currentCount - 1);
      fireTest("counter", true);
      fireTest("sprite", true);
      fireTest("name", true);
      fireTest("title", true);
      fireTest("odds", true);
      fireTest("phase", true);
      fireTest("total_counter", true);
    }
  };
  const testReset = () => {
    setFakeCount(0);
    fireTest("counter");
  };

  // History for undo/redo
  const history = useHistory<OverlaySettings>(settings, 400);

  // --- Modal state management ---
  const [colorPickerTarget, setColorPickerTarget] = useState<{
    currentColor: string;
    opacity?: number;
    showOpacity?: boolean;
    onConfirm: (color: string, opacity?: number) => void;
  } | null>(null);
  const [gradientEditorTarget, setGradientEditorTarget] = useState<{
    stops: GradientStop[];
    angle: number;
    onConfirm: (stops: GradientStop[], angle: number) => void;
  } | null>(null);
  const [shadowEditorTarget, setShadowEditorTarget] = useState<
    (ShadowConfirmParams & { onConfirm: (params: ShadowConfirmParams) => void }) | null
  >(null);
  const [outlineEditorTarget, setOutlineEditorTarget] = useState<OpenOutlineEditorParams | null>(
    null,
  );
  const [textColorEditorTarget, setTextColorEditorTarget] = useState<{
    colorType: "solid" | "gradient";
    color: string;
    gradientStops: GradientStop[];
    gradientAngle: number;
    onConfirm: (
      colorType: "solid" | "gradient",
      color: string,
      gradientStops: GradientStop[],
      gradientAngle: number,
    ) => void;
  } | null>(null);

  /** Open the shared ColorPickerModal bound to a specific property. */
  const openColorPicker = useCallback(
    (
      color: string,
      onPick: (c: string) => void,
      opts?: { opacity?: number; showOpacity?: boolean },
    ) => {
      setColorPickerTarget({
        currentColor: color,
        opacity: opts?.opacity,
        showOpacity: opts?.showOpacity,
        onConfirm: (c, o) => {
          onPick(c);
          if (opts?.showOpacity && o !== undefined) {
            /* handled by caller */
          }
        },
      });
    },
    [],
  );

  /** Open the shared OutlineEditorModal. */
  const openOutlineEditor = useCallback((params: OpenOutlineEditorParams) => {
    setOutlineEditorTarget(params);
  }, []);

  /** Open the shared ShadowEditorModal. */
  const openShadowEditor = useCallback(
    (params: ShadowConfirmParams & { onConfirm: (p: ShadowConfirmParams) => void }) => {
      setShadowEditorTarget(params);
    },
    [],
  );

  /** Open the shared TextColorEditorModal. */
  const openTextColorEditor = useCallback(
    (
      colorType: "solid" | "gradient",
      color: string,
      gradientStops: GradientStop[],
      gradientAngle: number,
      onConfirm: (ct: "solid" | "gradient", c: string, gs: GradientStop[], ga: number) => void,
    ) => {
      setTextColorEditorTarget({ colorType, color, gradientStops, gradientAngle, onConfirm });
    },
    [],
  );

  useEffect(() => {
    setLocalSettings(fillMissingElements(settings, t));
  }, [settings, t]);

  const {
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
  } = useCanvasZoomPan({ localSettings, effectiveTool });

  const update = useCallback(
    (s: OverlaySettings) => {
      setLocalSettings(s);
      onUpdate(s);
      history.push(s);
    },
    [onUpdate, history],
  );

  const updateSelectedEl = useCallback(
    (patch: Partial<OverlayElementBase>) => {
      if (selectedEl === "canvas") return;
      const el = localSettings[selectedEl] as OverlayElementBase;
      update({ ...localSettings, [selectedEl]: { ...el, ...patch } });
    },
    [localSettings, selectedEl, update],
  );

  /** Handles undo/redo keyboard shortcuts. Returns true if the event was handled. */
  const handleUndoRedo = useCallback(
    (e: KeyboardEvent): boolean => {
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        if (history.canUndo) {
          history.undo();
          const prev = history.current;
          setLocalSettings(prev);
          onUpdate(prev);
        }
        return true;
      }
      if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        if (history.canRedo) {
          history.redo();
          const next = history.current;
          setLocalSettings(next);
          onUpdate(next);
        }
        return true;
      }
      return false;
    },
    [history, onUpdate],
  );

  /** Handles arrow-key nudging and element selection shortcuts. Returns true if the event was handled. */
  const handleElementKeys = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!selectedEl || selectedEl === "canvas") return false;
      const el = localSettings[selectedEl] as OverlayElementBase;
      const step = e.shiftKey ? 10 : 1;

      const arrowActions: Record<string, () => void> = {
        ArrowLeft: () => updateSelectedEl({ x: el.x - step }),
        ArrowRight: () => updateSelectedEl({ x: el.x + step }),
        ArrowUp: () => updateSelectedEl({ y: el.y - step }),
        ArrowDown: () => updateSelectedEl({ y: el.y + step }),
      };

      const arrowAction = arrowActions[e.key];
      if (arrowAction) {
        e.preventDefault();
        arrowAction();
        return true;
      }
      if (e.key === "Escape") {
        setSelectedEl("sprite");
        return true;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const idx = ELEMENT_KEYS.indexOf(selectedEl);
        setSelectedEl(ELEMENT_KEYS[(idx + 1) % ELEMENT_KEYS.length]);
        return true;
      }
      return false;
    },
    [selectedEl, localSettings, updateSelectedEl],
  );

  // Keyboard navigation + spacebar for hand tool
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Every editor modal is a native <dialog> opened with showModal(). While
      // one is up the canvas shortcuts must stay out of the way: the Tab branch
      // below calls preventDefault(), which would otherwise pin the focus to
      // the dialog's first control and make the modal unusable by keyboard.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;

      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = ["INPUT", "SELECT", "TEXTAREA"].includes(tag);

      if (e.key === "Alt") {
        setAltHeld(true);
        return;
      }

      if (!isInput) {
        if (e.key === "v" || e.key === "V") {
          setActiveTool("pointer");
          return;
        }
        if (e.key === "h" || e.key === "H") {
          setActiveTool("hand");
          return;
        }
        if (e.key === "z" || e.key === "Z") {
          setActiveTool("zoom");
          return;
        }
      }

      // Space for hand tool (not in input/select/textarea)
      if (e.code === "Space" && !isInput) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (handleUndoRedo(e)) return;
      handleElementKeys(e);
    };
    const upHandler = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setAltHeld(false);
      }
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    };
    globalThis.addEventListener("keydown", handler);
    globalThis.addEventListener("keyup", upHandler);
    return () => {
      globalThis.removeEventListener("keydown", handler);
      globalThis.removeEventListener("keyup", upHandler);
    };
  }, [handleUndoRedo, handleElementKeys]);

  // Show tutorial on first visit
  useEffect(() => {
    if (!localStorage.getItem("encounty_editor_tutorial_seen")) {
      setShowTutorial(true);
    }
  }, []);

  /** Selects a specific element (e.g. on double-click) and scrolls its properties into view. */
  const openPropertiesForElement = useCallback((key: ElementKey) => {
    setSelectedEl(key);
  }, []);

  /** Uploads a background image file and applies it to the overlay settings. */
  const processBackgroundFile = async (file: File) => {
    setBgUploading(true);
    try {
      const filename = await uploadBackgroundImage(file);
      // Drop the image being replaced, otherwise every exchange leaves one
      // behind that nothing references again.
      const previous = localSettings.background_image;
      if (previous && previous !== filename) {
        void deleteBackgroundImage(previous).catch(() => {});
      }
      update({
        ...localSettings,
        background_image: filename,
        background_image_fit: localSettings.background_image_fit || "cover",
      });
    } catch (err) {
      console.error("Background upload failed:", err);
      push({ type: "error", title: t("overlay.errUploadFailed"), key: "overlay-bg-upload" });
    }
    setBgUploading(false);
  };

  // Background image upload handler
  const handleBgUpload = () => {
    pickImageFile((file) => processBackgroundFile(file));
  };

  const handleBgRemove = async () => {
    if (localSettings.background_image) {
      await deleteBackgroundImage(localSettings.background_image).catch(() =>
        push({ type: "error", title: t("overlay.errUploadFailed"), key: "overlay-bg-upload" }),
      );
      update({ ...localSettings, background_image: "", background_image_fit: "cover" });
    }
  };

  return (
    <div className={`flex min-h-0 h-full ${compact ? "pb-2" : ""}`}>
      {/* Left vertical toolbar */}
      <VerticalToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((v) => !v)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
        gridSize={gridSize}
        onGridSizeChange={setGridSize}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={() => {
          if (history.canUndo) {
            history.undo();
            setLocalSettings(history.current);
            onUpdate(history.current);
          }
        }}
        onRedo={() => {
          if (history.canRedo) {
            history.redo();
            setLocalSettings(history.current);
            onUpdate(history.current);
          }
        }}
        onFitToView={fitToView}
        canvasBg={canvasBg}
        onCanvasBgChange={setCanvasBg}
        zoom={zoom}
        mousePos={mousePos}
        activePokemon={!!activePokemon}
        currentCount={currentCount}
        onTestIncrement={testIncrement}
        onTestDecrement={testDecrement}
        onTestReset={testReset}
        onShowTutorial={() => setShowTutorial(true)}
      />

      {/* Center: Canvas (takes all remaining space) */}
      <div className="flex-1 min-w-0 flex flex-col p-2">
        <OverlayCanvas
          localSettings={localSettings}
          selectedEl={selectedEl}
          effectiveScale={effectiveScale}
          showGrid={showGrid}
          gridSize={gridSize}
          snapEnabled={snapEnabled}
          guides={guides}
          isDragging={isDragging}
          effectiveTool={effectiveTool}
          isPanDragging={isPanDragging}
          canvasBg={canvasBg}
          testTrigger={testTrigger}
          fakeCount={fakeCount}
          activePokemon={activePokemon}
          previewPokemonList={previewPokemonList}
          readOnly={readOnly}
          canvasContainerRef={canvasContainerRef}
          altHeld={altHeld}
          onMouseMove={handleCanvasMouseMove}
          onMouseDown={handleCanvasMouseDown}
          onMouseUp={handleCanvasMouseUp}
          onSelectElement={setSelectedEl}
          onDragStateChange={setIsDragging}
          onGuidesChange={setGuides}
          onUpdate={update}
          onZoomAtPoint={handleZoomAtPoint}
          onDoubleClickElement={openPropertiesForElement}
        />
      </div>

      {/* Right panel: Properties (top) + Layers (bottom) with draggable divider */}
      <div
        ref={rightColRef}
        className={`w-72 shrink-0 flex flex-col min-h-0 bg-bg-secondary border-l border-border-subtle ${readOnly ? "pointer-events-none opacity-60" : ""}`}
      >
        {/* Properties section (top, resizable) */}
        <div
          style={{ height: propertiesHeight }}
          className="overflow-y-auto shrink-0"
          data-tutorial="properties"
        >
          <div className="px-4 py-3">
            <OverlayPropertyPanel
              localSettings={localSettings}
              selectedEl={selectedEl}
              updateSelectedEl={updateSelectedEl}
              readOnly={readOnly}
              embedded
              activePokemon={activePokemon}
              onUpdate={update}
              openColorPicker={openColorPicker}
              openOutlineEditor={openOutlineEditor}
              openShadowEditor={openShadowEditor}
              openTextColorEditor={openTextColorEditor}
              fireTest={fireTest}
              bgPreviewUrl={bgPreviewUrl}
              bgUploading={bgUploading}
              onBgUpload={handleBgUpload}
              onBgRemove={handleBgRemove}
            />
          </div>
        </div>

        {/* Draggable divider */}
        <div className="relative group shrink-0">
          <button
            type="button"
            onMouseDown={startDividerDrag}
            onKeyDown={handleDividerKeyDown}
            className="w-full h-6 cursor-row-resize bg-transparent border-none p-0 flex items-center"
            aria-label={t("overlay.resizeDivider")}
          >
            {/* 24px tall hit target (WCAG 2.5.8) with a 6px visible bar centered inside */}
            <span className="w-full h-1.5 bg-border-subtle group-hover:bg-accent-blue/40 group-active:bg-accent-blue/60 transition-colors" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetEditorSplit();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-bg-secondary border border-border-subtle rounded-none p-1 text-text-muted hover:text-text-primary transition-opacity z-10 after:absolute after:-inset-2 after:content-['']"
            title={t("tooltip.editor.resetLayout")}
            aria-label={t("tooltip.editor.resetLayout")}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        {/* Layers section (bottom, fills remaining space) */}
        <LayersPanel
          localSettings={localSettings}
          selectedEl={selectedEl}
          onSelectElement={setSelectedEl}
          update={update}
          onShowTemplates={() => setShowTemplates(true)}
        />
      </div>

      {/* Template picker + its confirmation, both applied like the reset button */}
      {showTemplates && (
        <TemplatePickerModal
          onSelect={setPendingTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {pendingTemplate && (
        <ConfirmModal
          title={t("overlay.templateConfirmTitle")}
          message={t("overlay.templateConfirmMessage", { name: t(pendingTemplate.nameKey) })}
          confirmLabel={t("overlay.templateApply")}
          isDestructive
          onConfirm={() => update(pendingTemplate.settings)}
          onClose={() => setPendingTemplate(null)}
        />
      )}

      {/* Tutorial overlay */}
      {showTutorial && (
        <EditorTutorial
          onComplete={() => {
            setShowTutorial(false);
            setTutorialModal(null);
            localStorage.setItem("encounty_editor_tutorial_seen", "true");
          }}
          onSelectElement={setSelectedEl}
          onOpenModal={setTutorialModal}
        />
      )}

      {/* Dialogs a walkthrough step points into. They are deliberately wired to
          nothing: no onSelect, no onConfirm and no nested editor, so a step can
          show what a dialog looks like without ever writing a setting. The
          walkthrough re-enters the top layer above them, which makes them inert
          anyway, and leaving the step unmounts them. */}
      {tutorialModal === "templates" && <TemplatePickerModal onSelect={NOOP} onClose={NOOP} />}
      {tutorialModal === "text-color" && (
        <TextColorEditorModal
          colorType={localSettings.counter.style.color_type}
          color={localSettings.counter.style.color}
          gradientStops={localSettings.counter.style.gradient_stops}
          gradientAngle={localSettings.counter.style.gradient_angle}
          onConfirm={NOOP}
          onClose={NOOP}
          onOpenColorPicker={NOOP}
          onOpenGradientEditor={NOOP}
        />
      )}

      {/* --- Shared modal instances (unchanged) --- */}
      {colorPickerTarget && (
        <ColorPickerModal
          color={colorPickerTarget.currentColor}
          opacity={colorPickerTarget.opacity}
          showOpacity={colorPickerTarget.showOpacity}
          onConfirm={(color, opacity) => {
            colorPickerTarget.onConfirm(color, opacity);
            setColorPickerTarget(null);
          }}
          onClose={() => setColorPickerTarget(null)}
        />
      )}
      {gradientEditorTarget && (
        <GradientEditorModal
          stops={gradientEditorTarget.stops}
          angle={gradientEditorTarget.angle}
          onConfirm={(stops, angle) => {
            gradientEditorTarget.onConfirm(stops, angle);
            setGradientEditorTarget(null);
          }}
          onClose={() => setGradientEditorTarget(null)}
          onOpenColorPicker={(color, onPick) => openColorPicker(color, onPick)}
        />
      )}
      {shadowEditorTarget && (
        <ShadowEditorModal
          enabled={shadowEditorTarget.enabled}
          color={shadowEditorTarget.color}
          blur={shadowEditorTarget.blur}
          x={shadowEditorTarget.x}
          y={shadowEditorTarget.y}
          onConfirm={(params) => {
            shadowEditorTarget.onConfirm(params);
            setShadowEditorTarget(null);
          }}
          onClose={() => setShadowEditorTarget(null)}
          onOpenColorPicker={(color, onPick) => openColorPicker(color, onPick)}
        />
      )}
      {textColorEditorTarget && (
        <TextColorEditorModal
          colorType={textColorEditorTarget.colorType}
          color={textColorEditorTarget.color}
          gradientStops={textColorEditorTarget.gradientStops}
          gradientAngle={textColorEditorTarget.gradientAngle}
          onConfirm={(colorType, color, gradientStops, gradientAngle) => {
            textColorEditorTarget.onConfirm(colorType, color, gradientStops, gradientAngle);
            setTextColorEditorTarget(null);
          }}
          onClose={() => setTextColorEditorTarget(null)}
          onOpenColorPicker={(color, onPick) => openColorPicker(color, onPick)}
          onOpenGradientEditor={(stops, angle, onConfirm) =>
            setGradientEditorTarget({ stops, angle, onConfirm })
          }
        />
      )}
      {outlineEditorTarget && (
        <OutlineEditorModal
          type={outlineEditorTarget.type}
          color={outlineEditorTarget.color}
          width={outlineEditorTarget.width}
          gradientStops={outlineEditorTarget.gradientStops}
          gradientAngle={outlineEditorTarget.gradientAngle}
          onConfirm={(type, color, width, gradientStops, gradientAngle) => {
            outlineEditorTarget.onConfirm(type, color, width, gradientStops, gradientAngle);
            setOutlineEditorTarget(null);
          }}
          onClose={() => setOutlineEditorTarget(null)}
          onOpenColorPicker={(color, onPick) => openColorPicker(color, onPick)}
          onOpenGradientEditor={(stops, angle, onConfirm) =>
            setGradientEditorTarget({ stops, angle, onConfirm })
          }
        />
      )}
    </div>
  );
}
