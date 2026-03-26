import {
  Grid3X3,
  Hand,
  HelpCircle,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RefreshCw,
  Undo2,
  ZoomIn,
} from "lucide-react";

import { useI18n } from "../../contexts/I18nContext";

interface VerticalToolbarProps {
  activeTool: "pointer" | "hand" | "zoom";
  onToolChange: (tool: "pointer" | "hand" | "zoom") => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  gridSize: number;
  onGridSizeChange: (size: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFitToView: () => void;
  canvasBg: "transparent" | "white" | "black";
  onCanvasBgChange: (bg: "transparent" | "white" | "black") => void;
  zoom: number;
  mousePos: { x: number; y: number };
  activePokemon: boolean;
  currentCount: number;
  onTestIncrement: () => void;
  onTestDecrement: () => void;
  onTestReset: () => void;
  onShowTutorial: () => void;
}

/** Vertical toolbar for the overlay editor, positioned on the left side. */
export function VerticalToolbar({
  activeTool,
  onToolChange,
  showGrid,
  onToggleGrid,
  snapEnabled,
  onToggleSnap,
  gridSize,
  onGridSizeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFitToView,
  canvasBg,
  onCanvasBgChange,
  zoom,
  mousePos,
  activePokemon,
  currentCount,
  onTestIncrement,
  onTestDecrement,
  onTestReset,
  onShowTutorial,
}: VerticalToolbarProps) {
  const { t } = useI18n();

  const iconClass = "w-4 h-4";

  const toolBtnClass = (active: boolean) =>
    `p-1.5 rounded transition-colors ${
      active
        ? "text-accent-blue bg-accent-blue/20"
        : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
    }`;

  const actionBtnClass = (disabled: boolean) =>
    `p-1.5 rounded transition-colors ${
      disabled
        ? "opacity-30 cursor-not-allowed text-text-muted"
        : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
    }`;

  return (
    <div
      data-tutorial="toolbar"
      className="w-10 shrink-0 flex flex-col items-center py-2 gap-1 bg-bg-secondary border-r border-border-subtle"
    >
      {/* --- Tool Buttons --- */}
      <button
        onClick={() => onToolChange("pointer")}
        title={`${t("tooltip.editor.pointer")} (V)`}
        aria-label={`${t("tooltip.editor.pointer")} (V)`}
        className={toolBtnClass(activeTool === "pointer")}
      >
        <MousePointer2 className={iconClass} />
      </button>
      <button
        onClick={() => onToolChange("hand")}
        title={`${t("tooltip.editor.hand")} (H)`}
        aria-label={`${t("tooltip.editor.hand")} (H)`}
        className={toolBtnClass(activeTool === "hand")}
      >
        <Hand className={iconClass} />
      </button>
      <button
        onClick={() => onToolChange("zoom")}
        title="Zoom (Z)"
        aria-label="Zoom (Z)"
        className={toolBtnClass(activeTool === "zoom")}
      >
        <ZoomIn className={iconClass} />
      </button>

      <div className="h-px w-full bg-border-subtle my-1.5 mx-2" />

      {/* --- Grid / Snap --- */}
      <button
        onClick={onToggleGrid}
        title={t("tooltip.editor.grid")}
        aria-label={t("tooltip.editor.grid")}
        className={toolBtnClass(showGrid)}
      >
        <Grid3X3 className={iconClass} />
      </button>
      <button
        onClick={onToggleSnap}
        title={t("tooltip.editor.snap")}
        aria-label={t("tooltip.editor.snap")}
        className={toolBtnClass(snapEnabled)}
      >
        <Magnet className={iconClass} />
      </button>

      {showGrid && (
        <select
          value={gridSize}
          onChange={(e) => onGridSizeChange(Number(e.target.value))}
          aria-label={t("aria.gridSize")}
          className="w-8 text-[11px] bg-bg-card border border-border-subtle rounded px-0.5 py-0.5 text-text-primary text-center"
        >
          <option value={8}>8</option>
          <option value={16}>16</option>
          <option value={32}>32</option>
        </select>
      )}

      <div className="h-px w-full bg-border-subtle my-1.5 mx-2" />

      {/* --- History --- */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title={`${t("tooltip.editor.undo")} (Strg+Z)`}
        aria-label={`${t("tooltip.editor.undo")} (Strg+Z)`}
        className={actionBtnClass(!canUndo)}
      >
        <Undo2 className={iconClass} />
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title={`${t("tooltip.editor.redo")} (Strg+Y)`}
        aria-label={`${t("tooltip.editor.redo")} (Strg+Y)`}
        className={actionBtnClass(!canRedo)}
      >
        <Redo2 className={iconClass} />
      </button>

      <div className="h-px w-full bg-border-subtle my-1.5 mx-2" />

      {/* --- View --- */}
      <button
        onClick={onFitToView}
        title={t("tooltip.editor.fitView")}
        aria-label={t("tooltip.editor.fitView")}
        className="p-1.5 rounded transition-colors text-text-muted hover:text-text-primary hover:bg-bg-hover"
      >
        <Maximize className={iconClass} />
      </button>

      <div className="h-px w-full bg-border-subtle my-1.5 mx-2" />

      {/* --- Animation Test --- */}
      <button
        onClick={onTestIncrement}
        disabled={!activePokemon}
        title={t("tooltip.editor.previewIncrement")}
        aria-label={t("tooltip.editor.previewIncrement")}
        className={`p-1.5 rounded transition-colors ${
          !activePokemon
            ? "opacity-30 cursor-not-allowed text-accent-green"
            : "text-accent-green hover:bg-bg-hover"
        }`}
      >
        <Plus className={iconClass} />
      </button>
      <button
        onClick={onTestDecrement}
        disabled={!activePokemon || currentCount <= 0}
        title={t("tooltip.editor.previewDecrement")}
        aria-label={t("tooltip.editor.previewDecrement")}
        className={`p-1.5 rounded transition-colors ${
          !activePokemon || currentCount <= 0
            ? "opacity-30 cursor-not-allowed text-accent-yellow"
            : "text-accent-yellow hover:bg-bg-hover"
        }`}
      >
        <Minus className={iconClass} />
      </button>
      <button
        onClick={onTestReset}
        disabled={!activePokemon}
        title={t("tooltip.editor.previewReset")}
        aria-label={t("tooltip.editor.previewReset")}
        className={`p-1.5 rounded transition-colors ${
          !activePokemon
            ? "opacity-30 cursor-not-allowed text-text-muted"
            : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
        }`}
      >
        <RefreshCw className={iconClass} />
      </button>

      <div className="h-px w-full bg-border-subtle my-1.5 mx-2" />

      {/* --- Canvas Background --- */}
      <div className="flex flex-col items-center gap-0.5">
        {(["transparent", "white", "black"] as const).map((bg) => {
          const titleMap = {
            transparent: t("tooltip.editor.bgTransparent"),
            white: t("tooltip.editor.bgWhite"),
            black: t("tooltip.editor.bgBlack"),
          };

          return (
            <button
              key={bg}
              onClick={() => onCanvasBgChange(bg)}
              title={titleMap[bg]}
              aria-label={titleMap[bg]}
              className={`p-1.5 rounded transition-colors ${
                canvasBg === bg
                  ? "bg-accent-blue/20 ring-1 ring-accent-blue"
                  : "hover:bg-bg-hover"
              }`}
            >
              <div
                className="w-5 h-3 rounded-sm border border-border-subtle"
                style={{
                  background:
                    bg === "transparent"
                      ? "repeating-conic-gradient(#666 0% 25%, #999 0% 50%) 50% / 6px 6px"
                      : bg === "black"
                        ? "#1a1a1a"
                        : "#e5e5e5",
                }}
              />
            </button>
          );
        })}
      </div>

      {/* --- Spacer --- */}
      <div className="flex-1" />

      {/* --- Status --- */}
      <div className="flex flex-col items-center gap-0.5 text-[10px] text-text-muted font-mono leading-tight">
        <span>X:{mousePos.x}</span>
        <span>Y:{mousePos.y}</span>
      </div>
      <span className="text-[10px] text-text-muted font-mono mt-0.5">
        {Math.round(zoom * 100)}%
      </span>

      {/* --- Help --- */}
      <button
        onClick={onShowTutorial}
        title={t("tooltip.editor.showTutorial")}
        aria-label={t("tooltip.editor.showTutorial")}
        className="p-1.5 rounded transition-colors text-text-muted hover:text-text-primary hover:bg-bg-hover mt-1"
      >
        <HelpCircle className={iconClass} />
      </button>
    </div>
  );
}
