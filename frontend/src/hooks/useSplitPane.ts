import { useCallback, useEffect, useRef, useState } from "react";

/** How far one arrow key press moves the divider, in pixels. */
const KEYBOARD_STEP_PX = 24;

/** Configuration of one resizable split, all sizes in CSS pixels. */
export interface UseSplitPaneOptions {
  /** localStorage key the dragged size is persisted under. */
  readonly storageKey: string;
  /** Size of the top pane on a fresh install and after a layout reset. */
  readonly defaultSizePx: number;
  /** Smallest size the top pane may be dragged to. */
  readonly minSizePx: number;
  /** Fixed chrome below the top pane (divider, and any tab strip under it). */
  readonly reservedPx: number;
  /** Size the bottom pane is kept at while the column is tall enough for it. */
  readonly minReservePx: number;
  /**
   * Measures where `contentRef` starts inside the container and subtracts that
   * offset. Needed when a header of variable height sits between the two, and
   * must stay false for a column whose top pane starts at the very top.
   */
  readonly measureContentOffset?: boolean;
}

/** Everything a split-pane divider needs to be wired into JSX. */
export interface UseSplitPaneResult {
  /** Current size of the top pane, to be applied as an inline height. */
  readonly size: number;
  /** Attach to the column that holds both panes and the divider. */
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the top pane, only read when `measureContentOffset` is set. */
  readonly contentRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the divider's `onMouseDown`. */
  readonly startDrag: (e: React.MouseEvent) => void;
  /** Attach to the divider's `onKeyDown`; arrow up and down resize it. */
  readonly handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Restores the default size and forgets the persisted one. */
  readonly reset: () => void;
}

/**
 * useSplitPane drives a vertically resizable two-pane column whose divider is
 * draggable with the mouse and with the arrow keys.
 *
 * The size is clamped against the measured height of the container rather than
 * against a chrome constant subtracted from `innerHeight`: the amount of chrome
 * above a column varies with the title bar breakpoint and with headers that
 * wrap on narrow windows, so any constant would be wrong exactly on the short
 * windows the clamping guards against. A ResizeObserver re-clamps on every
 * container resize, because a column also shrinks without the window changing
 * size, for example when a wrapping header gains a line.
 */
export function useSplitPane(options: UseSplitPaneOptions): UseSplitPaneResult {
  const {
    storageKey,
    defaultSizePx,
    minSizePx,
    reservedPx,
    minReservePx,
    measureContentOffset = false,
  } = options;

  const [size, setSize] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? Number(stored) : defaultSizePx;
    } catch {
      return defaultSizePx;
    }
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  /** Writes the size through, tolerating a storage that refuses to be written. */
  const persist = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {}
    },
    [storageKey],
  );

  const clamp = useCallback(
    (h: number) => {
      const container = containerRef.current;
      const content = contentRef.current;
      // The lower bound does not depend on a measurement. The upper one does, so
      // before the first measurement it is skipped; the observer below corrects
      // the value on the first frame after mount.
      if (!container || (measureContentOffset && !content) || container.clientHeight === 0) {
        return Math.max(minSizePx, h);
      }
      // Reading the offset from the rects stays correct even while the current
      // size overflows the container.
      const offset =
        measureContentOffset && content
          ? content.getBoundingClientRect().top - container.getBoundingClientRect().top
          : 0;
      const flexible = container.clientHeight - offset - reservedPx;
      // Reserve for the pane below, but never more than half of what there is:
      // on a very short column an even split beats starving one pane.
      const reserve = Math.min(minReservePx, Math.max(0, Math.floor(flexible / 2)));
      return Math.max(minSizePx, Math.min(h, flexible - reserve));
    },
    [measureContentOffset, minSizePx, reservedPx, minReservePx],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setSize(clamp));
    observer.observe(container);
    return () => observer.disconnect();
  }, [clamp]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startHeight: size };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dy = ev.clientY - dragRef.current.startY;
        setSize(clamp(dragRef.current.startHeight + dy));
      };
      const onUp = () => {
        globalThis.removeEventListener("mousemove", onMove);
        globalThis.removeEventListener("mouseup", onUp);
        setSize((h) => {
          persist(h);
          return h;
        });
        dragRef.current = null;
      };
      globalThis.addEventListener("mousemove", onMove);
      globalThis.addEventListener("mouseup", onUp);
    },
    [size, clamp, persist],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const step = e.key === "ArrowUp" ? -KEYBOARD_STEP_PX : KEYBOARD_STEP_PX;
      setSize((h) => {
        const newH = clamp(h + step);
        persist(newH);
        return newH;
      });
    },
    [clamp, persist],
  );

  const reset = useCallback(() => {
    setSize(clamp(defaultSizePx));
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  }, [clamp, defaultSizePx, storageKey]);

  return { size, containerRef, contentRef, startDrag, handleKeyDown, reset };
}
