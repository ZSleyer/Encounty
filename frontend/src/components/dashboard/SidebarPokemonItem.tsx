/**
 * SidebarPokemonItem.tsx: One Pokemon row of the expanded sidebar list.
 *
 * The row owns everything that is purely about presenting a single hunt:
 * sprite, caught/failed badge, name, running-phase badge, the merged metadata
 * line, tag dots or chips, and the drag placeholder around it. Selection,
 * ordering and hunt control stay with the Dashboard and arrive as props.
 */

import { Fragment } from "react";
import { Keyboard, Pencil, Trophy, Video, VideoOff, XCircle } from "lucide-react";
import { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { pokemonDisplayName } from "../../utils/pokemon";
import { isLoopRunning } from "../../engine/DetectionLoop";
import { TagChip } from "../shared/TagChip";
import { hasDetectorReady, isTimerStartBlocked } from "./huntMode";
import { phaseOriginLabel, type PhaseIndex } from "./phaseHelpers";
import { SidebarHuntStatus } from "./SidebarHuntStatus";
import {
  buildSidebarItemClass,
  formatGame,
  getBaseAndFormName,
  sidebarItemBorderClass,
  sidebarSpriteUrl,
  tagDotColor,
} from "./presentation";

/**
 * Drag-and-drop reorder state of the sidebar list, shared by every row.
 *
 * Bundled rather than passed as six loose props because a row needs the whole
 * set at once to decide whether it is the dragged item, the hovered item, or
 * the one that has to make room.
 */
export interface SidebarDragState {
  /** Id of the row currently being dragged, or null when no drag is active. */
  draggingId: string | null;
  /** Id of the row the cursor last hovered during the drag. */
  overId: string | null;
  /** Whether the drop slot belongs below the hovered row instead of above it. */
  dropAfter: boolean;
  /** Reports that a drag started on the given row. */
  onDragStart: (pokemonId: string) => void;
  /** Reports the hovered row and on which half of it the cursor sits. */
  onDragOver: (pokemonId: string, after: boolean) => void;
  /** Reports the end of the drag, which is where the reorder is persisted. */
  onDragEnd: () => void;
}

/**
 * Everything a sidebar row needs to show and toggle a hunt.
 *
 * These five travel together into `SidebarHuntStatus` and the hotkey-target
 * button, so they are grouped instead of drilled individually.
 */
export interface SidebarHuntControls {
  /** Sends a WebSocket message to the backend. */
  send: (type: string, payload: unknown) => void;
  capture: {
    isCapturing: (id: string) => boolean;
    getVideoElement: (id: string) => HTMLVideoElement | null;
  };
  /** Live detector state per Pokemon id. */
  detectorStatus: Record<string, unknown>;
  setDetectorStatus: (
    id: string,
    status: { state: string; confidence: number; poll_ms: number; cooldown_remaining_ms?: number },
  ) => void;
  clearDetectorStatus: (id: string) => void;
}

/** Renders one `<li>` Pokemon row plus its drag placeholder. */
export function SidebarPokemonItem({
  pokemon,
  idx,
  isViewed,
  isHotkeyTarget,
  isSelected,
  isFocused,
  imgError,
  onImgError,
  phaseIndex,
  drag,
  hunt,
  activeTagFilters,
  onToggleTagFilter,
  onClick,
  onKeyDown,
  onEdit,
}: Readonly<{
  pokemon: Pokemon;
  /** Absolute position in the flat display list; drives roving keyboard focus. */
  idx: number;
  isViewed: boolean;
  /** Whether the global hotkeys currently count this Pokemon. */
  isHotkeyTarget: boolean;
  /** Whether the row is part of the bulk selection. */
  isSelected: boolean;
  /** Whether the roving sidebar focus sits on this row. */
  isFocused: boolean;
  /** Sprite urls that failed to load, keyed by Pokemon id. */
  imgError: Record<string, string>;
  onImgError: (pokemonId: string, src: string) => void;
  /** Precomputed phase lookups, so a row never rescans the whole list. */
  phaseIndex: PhaseIndex;
  drag: SidebarDragState;
  hunt: SidebarHuntControls;
  activeTagFilters: string[];
  onToggleTagFilter: (tag: string) => void;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onEdit: () => void;
}>) {
  const { t } = useI18n();
  const { send, capture, detectorStatus, setDetectorStatus, clearDetectorStatus } = hunt;
  const p = pokemon;
  const isCaught = !!p.completed_at;
  const src = sidebarSpriteUrl(p, imgError);
  const itemBorderClass = sidebarItemBorderClass(isSelected, isViewed);
  const itemClassName = buildSidebarItemClass(itemBorderClass, isFocused);
  const [baseName, formName] = getBaseAndFormName(p);
  const tags = p.tags ?? [];
  const originLabel = phaseOriginLabel(p, phaseIndex.nameById.get(p.phase_of ?? ""), t);
  // The running phase is max(finished) + 1; without a finished phase the hunt
  // is still in phase 1 and stays unmarked.
  const finishedPhases = phaseIndex.latestPhase.get(p.id);
  const runningPhase = isCaught || finishedPhases === undefined ? null : finishedPhases + 1;
  // Full metadata as tooltip since the merged line truncates.
  const metaTitle = [
    formName,
    p.game ? formatGame(p.game) : "",
    String(p.encounters),
    originLabel ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  // While dragging, show an empty dashed slot at the drop position so the
  // other items visibly make room (the dragged row itself is dimmed). The
  // slot sits above the hovered item, or below it when the cursor is over the
  // lower half (which also lets the user drop into the very last position).
  const isDropTarget = !!drag.draggingId && drag.draggingId !== p.id && drag.overId === p.id;
  const dropSlot = (
    <li
      aria-hidden="true"
      className="h-11 mx-1 my-1 rounded-none border-2 border-dashed border-accent-blue bg-accent-blue/10 pointer-events-none"
    />
  );
  return (
    <Fragment>
      {isDropTarget && !drag.dropAfter && dropSlot}
      <li
        aria-current={isViewed ? "true" : undefined}
        data-sidebar-idx={idx}
        tabIndex={0}
        draggable
        className={`${itemClassName}${drag.draggingId === p.id ? " opacity-40" : ""}`}
        onClick={onClick}
        onKeyDown={onKeyDown}
        data-selected={isSelected || undefined}
        onDragStart={() => drag.onDragStart(p.id)}
        onDragOver={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          if (drag.overId !== p.id || drag.dropAfter !== after) drag.onDragOver(p.id, after);
        }}
        onDrop={(e) => e.preventDefault()}
        onDragEnd={() => drag.onDragEnd()}
      >
        {/* aria-selected is invalid on a plain li, so the bulk-selection
          state is announced through visually hidden text instead. */}
        {isSelected && <span className="sr-only">{t("timer.selected")}</span>}
        <div className="w-8 h-8 2xl:w-10 2xl:h-10 shrink-0 relative self-start mt-0.5">
          <img
            src={src}
            alt={pokemonDisplayName(p)}
            onError={() => onImgError(p.id, src)}
            className="pokemon-sprite w-full h-full object-contain"
          />
          {/* Decorative: the caught/failed state is already carried by the
            selected Pokédex tab this row can only appear under. */}
          {isCaught && !p.failed && (
            <div
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 bg-accent-green rounded-none p-0.5"
            >
              <Trophy className="w-2 h-2 text-text-primary" />
            </div>
          )}
          {isCaught && p.failed && (
            <div
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 bg-accent-red rounded-none p-0.5"
            >
              <XCircle className="w-2 h-2 text-text-primary" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {/* Row 1: Name + Actions */}
          <div className="flex items-center gap-1">
            <span
              className="text-[13px] 2xl:text-sm font-semibold text-text-primary truncate flex-1 capitalize"
              title={pokemonDisplayName(p)}
            >
              {baseName}
            </span>
            {runningPhase !== null && (
              <span
                className="shrink-0 border border-accent-purple/40 text-accent-purple text-[10px] px-1 rounded-none tabular-nums"
                title={t("phase.badge", { number: runningPhase })}
              >
                {t("phase.short", { number: runningPhase })}
              </span>
            )}
            <div className="flex gap-0.5 items-center shrink-0">
              {hasDetectorReady(p) &&
                (capture.isCapturing(p.id) ? (
                  <span className="p-0.5" title={t("sidebar.sourceConnected")}>
                    <Video
                      className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-accent-green"
                      aria-label={t("sidebar.sourceConnected")}
                    />
                  </span>
                ) : (
                  <span className="p-0.5" title={t("sidebar.sourceDisconnected")}>
                    <VideoOff
                      className="w-3 h-3 2xl:w-3.5 2xl:h-3.5 text-accent-red/70"
                      aria-label={t("sidebar.sourceDisconnected")}
                    />
                  </span>
                ))}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  send("set_active", { pokemon_id: p.id });
                }}
                className={`min-w-6 min-h-6 flex items-center justify-center rounded-none transition-colors hover:text-accent-blue ${
                  isHotkeyTarget ? "text-accent-blue" : "text-text-faint/40"
                }`}
                title={isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")}
                aria-label={isHotkeyTarget ? t("dash.hotkeyTargetActive") : t("dash.hotkeyTarget")}
                aria-pressed={isHotkeyTarget}
              >
                <Keyboard className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="min-w-6 min-h-6 flex items-center justify-center rounded-none text-text-faint hover:text-text-primary transition-colors"
                title={t("dash.edit")}
              >
                <Pencil className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              </button>
            </div>
          </div>
          {/* Row 2: Form · Game · Count + tag dots + Timer/Play (single merged metadata line) */}
          <div className="flex items-center gap-1.5 text-[11px] 2xl:text-xs text-text-muted">
            <span className="flex-1 min-w-0 truncate" title={metaTitle}>
              {formName && <span className="capitalize">{formName}</span>}
              {formName && p.game && <span className="text-text-faint"> · </span>}
              {p.game && <span>{formatGame(p.game)}</span>}
              {(formName || p.game) && <span className="text-text-faint"> · </span>}
              <span className="tabular-nums">{p.encounters}</span>
              {originLabel && (
                <>
                  <span className="text-text-faint"> · </span>
                  <span className="text-accent-purple">{originLabel}</span>
                </>
              )}
            </span>
            {!isViewed && tags.length > 0 && (
              <span className="flex items-center gap-1 shrink-0" title={tags.join(", ")}>
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    aria-hidden="true"
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: tagDotColor(tag) }}
                  />
                ))}
                <span className="sr-only">{tags.join(", ")}</span>
              </span>
            )}
            <SidebarHuntStatus
              pokemon={p}
              send={send}
              detectorRunning={!!detectorStatus[p.id] || isLoopRunning(p.id)}
              disabled={!!p.completed_at}
              timerStartBlocked={isTimerStartBlocked(p, capture.isCapturing)}
              capture={capture}
              detectorStatus={detectorStatus}
              setDetectorStatus={setDetectorStatus}
              clearDetectorStatus={clearDetectorStatus}
            />
          </div>
          {/* Full tag chips only for the currently viewed hunt */}
          {isViewed && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 min-w-0 mt-0.5">
              {tags.slice(0, 3).map((tag) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  size="sm"
                  active={activeTagFilters.includes(tag)}
                  onClick={() => onToggleTagFilter(tag)}
                />
              ))}
            </div>
          )}
        </div>
      </li>
      {isDropTarget && drag.dropAfter && dropSlot}
    </Fragment>
  );
}
