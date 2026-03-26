import { useCallback, useEffect, useRef, useState } from "react";

interface UseDraggableWindowOptions {
  storageKey: string;
  defaultPosition?: { x: number; y: number };
}

interface UseDraggableWindowResult {
  position: { x: number; y: number };
  handleMouseDown: (e: React.MouseEvent) => void;
}

interface DragState {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

/**
 * Manages a draggable floating window position with localStorage persistence.
 *
 * Attach `handleMouseDown` to the title bar element. The position is clamped
 * to the viewport on every move and saved to localStorage on mouse up.
 */
export function useDraggableWindow(
  options: UseDraggableWindowOptions
): UseDraggableWindowResult {
  const { storageKey, defaultPosition } = options;
  const fallback = defaultPosition ?? { x: 100, y: 100 };

  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          typeof parsed.x === "number" &&
          typeof parsed.y === "number"
        ) {
          return parsed;
        }
      }
    } catch {
      // Ignore malformed data
    }
    return fallback;
  });

  const dragRef = useRef<DragState | null>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    const clampedX = Math.max(
      0,
      Math.min(drag.origX + dx, window.innerWidth - 200)
    );
    const clampedY = Math.max(
      0,
      Math.min(drag.origY + dy, window.innerHeight - 100)
    );

    setPosition({ x: clampedX, y: clampedY });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);

    // Persist final position
    setPosition((pos) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(pos));
      } catch {
        // Storage may be full or unavailable
      }
      return pos;
    });
  }, [handleMouseMove, storageKey]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: position.x,
        origY: position.y,
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [position, handleMouseMove, handleMouseUp]
  );

  // Clean up global listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return { position, handleMouseDown };
}
