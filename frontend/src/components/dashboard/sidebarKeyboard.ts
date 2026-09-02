/**
 * sidebarKeyboard.ts: Keyboard navigation and multi-select of the sidebar.
 *
 * Arrow keys move the roving focus, Space toggles selection, Ctrl/Shift clicks
 * extend it. The handlers take an explicit context object so the page can keep
 * owning the state they read and write.
 */

import { useEffect } from "react";
import { Pokemon } from "../../types";

/** Context needed for sidebar keyboard navigation dispatch. */
export interface SidebarKeyboardContext {
  aside: HTMLElement;
  displayList: Pokemon[];
  focusedIdx: number | null;
  selectedIds: Set<string>;
  searchQuery: string;
  setFocusedIdx: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  bulkDelete: () => void;
}

/**
 * nextFocusIdx resolves the roving-focus target of an arrow key. Without a
 * focused item the list is entered from the pressed key's end, otherwise the
 * index steps and clamps at the far end rather than wrapping around.
 */
function nextFocusIdx(down: boolean, focusedIdx: number | null, count: number): number {
  if (focusedIdx === null) return down ? 0 : count - 1;
  return down ? Math.min(focusedIdx + 1, count - 1) : Math.max(focusedIdx - 1, 0);
}

/** Handles ArrowDown/Up navigation in the sidebar list. */
function handleSidebarArrow(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  e.preventDefault();
  const next = nextFocusIdx(e.key === "ArrowDown", ctx.focusedIdx, ctx.displayList.length);
  ctx.setFocusedIdx(next);
  // Move real DOM focus along with the visual highlight so keyboard/AT users
  // land on the same item the highlight indicates, not just a visual cursor.
  const el = ctx.aside.querySelector<HTMLElement>(`[data-sidebar-idx="${next}"]`);
  el?.focus();
}

/**
 * Toggles selection of the focused sidebar item on Space. Enter (activate) is
 * handled by the item's own onKeyDown so it fires exactly once; routing it here
 * too would double-invoke handleActivate and cancel its view toggle.
 */
function handleSidebarFocusedAction(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  if (ctx.focusedIdx === null || !ctx.displayList[ctx.focusedIdx]) return;
  e.preventDefault();
  const item = ctx.displayList[ctx.focusedIdx];
  ctx.setSelectedIds((prev) => {
    const n = new Set(prev);
    if (n.has(item.id)) {
      n.delete(item.id);
    } else {
      n.add(item.id);
    }
    return n;
  });
}

/** Dispatches sidebar keyboard events for navigation and selection. */
function handleSidebarKeyboard(e: KeyboardEvent, ctx: SidebarKeyboardContext): void {
  if (!ctx.aside.contains(document.activeElement) && document.activeElement !== document.body)
    return;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    handleSidebarArrow(e, ctx);
  } else if (e.key === " ") {
    handleSidebarFocusedAction(e, ctx);
  } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    ctx.setSelectedIds(new Set(ctx.displayList.map((p) => p.id)));
  } else if (e.key === "Escape") {
    if (ctx.selectedIds.size > 0) ctx.setSelectedIds(new Set());
    else if (ctx.searchQuery) ctx.setSearchQuery("");
  } else if (e.key === "Delete" && ctx.selectedIds.size > 0) {
    e.preventDefault();
    ctx.bulkDelete();
  }
}

/** Context needed for sidebar card multi-select. */
export interface CardSelectionContext {
  displayList: Pokemon[];
  selectedIds: Set<string>;
  lastSelectedIdx: React.RefObject<number | null>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleActivate: (id: string) => void;
  viewedPokemonId: string | null;
}

/** Handle sidebar card clicks with Ctrl/Shift multi-select support. */
export function applyCardSelection(
  e: React.MouseEvent,
  pokemonId: string,
  idx: number,
  ctx: CardSelectionContext,
): void {
  if (e.ctrlKey || e.metaKey) {
    ctx.setSelectedIds((prev) => {
      const next = new Set(prev);
      // First Ctrl+click: also include the currently viewed pokemon so both end up selected
      if (next.size === 0 && ctx.viewedPokemonId && ctx.viewedPokemonId !== pokemonId) {
        next.add(ctx.viewedPokemonId);
      }
      if (next.has(pokemonId)) next.delete(pokemonId);
      else next.add(pokemonId);
      return next;
    });
    ctx.lastSelectedIdx.current = idx;
  } else if (e.shiftKey && ctx.lastSelectedIdx.current !== null) {
    const from = Math.min(ctx.lastSelectedIdx.current, idx);
    const to = Math.max(ctx.lastSelectedIdx.current, idx);
    ctx.setSelectedIds((prev) => {
      const next = new Set(prev);
      for (let i = from; i <= to; i++) next.add(ctx.displayList[i].id);
      return next;
    });
  } else {
    if (ctx.selectedIds.size > 0) ctx.setSelectedIds(new Set());
    ctx.handleActivate(pokemonId);
  }
}

/** Handles Enter/Space keydown to activate a Pokemon in the sidebar. */
export function handleActivateKeyDown(
  e: React.KeyboardEvent,
  pokemonId: string,
  onActivate: (id: string) => void,
): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onActivate(pokemonId);
  }
}

/** Registers sidebar keyboard navigation handlers on the global window. */
export function useSidebarKeyboard(
  asideRef: React.RefObject<HTMLElement | null>,
  deps: Omit<SidebarKeyboardContext, "aside">,
) {
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const ctx: SidebarKeyboardContext = { aside, ...deps };
    const handleKey = (e: KeyboardEvent) => handleSidebarKeyboard(e, ctx);
    globalThis.addEventListener("keydown", handleKey);
    return () => globalThis.removeEventListener("keydown", handleKey);
  }, [deps.displayList, deps.focusedIdx, deps.selectedIds, deps.searchQuery]);
}

/** Scrolls the focused sidebar item into view if a focused index is set. */
export function scrollFocusedIntoView(
  focusedIdx: number | null,
  asideRef: React.RefObject<HTMLElement | null>,
): void {
  if (focusedIdx === null) return;
  asideRef.current
    ?.querySelector(`[data-sidebar-idx="${focusedIdx}"]`)
    ?.scrollIntoView({ block: "nearest" });
}
