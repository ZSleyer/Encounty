/**
 * ToastContext.tsx — Toast notification system.
 *
 * Toasts auto-dismiss after a configurable duration (default 2 s; 3 s for
 * "encounter" type). When an encounter toast for the same sprite already
 * exists it is replaced in-place rather than stacked, so rapid increments
 * only show one toast per Pokémon at a time. The stack is capped at 5.
 */
import { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";

export type ToastType = "success" | "error" | "info" | "encounter";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  spriteUrl?: string;
  badge?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
  /** pause suspends a toast's auto-dismiss timer, e.g. while hovered or focused. */
  pause: (id: string) => void;
  /** resume restarts a paused toast's auto-dismiss timer for its remaining duration. */
  resume: (id: string) => void;
}

/** Bookkeeping for a toast's auto-dismiss timer, kept outside React state so
 * pausing/resuming never triggers a re-render of the provider itself. */
interface TimerEntry {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

const ToastContext = createContext<ToastContextType | null>(null);

/** ToastProvider supplies the toast queue and push/dismiss actions to the tree. */
export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, TimerEntry>>(new Map());

  const dismiss = useCallback((id: string) => {
    const entry = timers.current.get(id);
    if (entry?.handle) clearTimeout(entry.handle);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const scheduleTimer = useCallback(
    (id: string, remaining: number) => {
      const handle = setTimeout(() => dismiss(id), remaining);
      timers.current.set(id, { handle, remaining, startedAt: Date.now() });
    },
    [dismiss],
  );

  const pause = useCallback((id: string) => {
    const entry = timers.current.get(id);
    if (!entry?.handle) return; // unknown or already paused
    clearTimeout(entry.handle);
    const elapsed = Date.now() - entry.startedAt;
    timers.current.set(id, {
      handle: null,
      remaining: Math.max(entry.remaining - elapsed, 0),
      startedAt: Date.now(),
    });
  }, []);

  const resume = useCallback(
    (id: string) => {
      const entry = timers.current.get(id);
      if (!entry || entry.handle) return; // unknown or not paused
      scheduleTimer(id, entry.remaining);
    },
    [scheduleTimer],
  );

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      const duration = toast.duration ?? (toast.type === "encounter" ? 3000 : 2000);

      // Show system notification when the page is hidden (minimized / background tab)
      if (document.hidden && "Notification" in globalThis) {
        if (Notification.permission === "granted") {
          new Notification(toast.title, {
            body: toast.message,
            icon: toast.spriteUrl,
          });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then((perm) => {
            if (perm === "granted") {
              new Notification(toast.title, {
                body: toast.message,
                icon: toast.spriteUrl,
              });
            }
          });
        }
      }

      setToasts((prev) => {
        // For encounter toasts: replace existing encounter toast for same sprite
        if (toast.type === "encounter") {
          const existing = prev.find(
            (t) => t.type === "encounter" && t.spriteUrl === toast.spriteUrl,
          );
          if (existing) {
            const oldEntry = timers.current.get(existing.id);
            if (oldEntry?.handle) clearTimeout(oldEntry.handle);
            timers.current.delete(existing.id);
            scheduleTimer(id, duration);
            return prev.map((t) =>
              t.id === existing.id ? { ...toast, id } : t,
            );
          }
        }
        // Keep max 5 toasts
        const next = prev.length >= 5 ? prev.slice(1) : prev;
        scheduleTimer(id, duration);
        return [...next, { ...toast, id }];
      });
    },
    [scheduleTimer],
  );

  const value = useMemo(
    () => ({ toasts, push, dismiss, pause, resume }),
    [toasts, push, dismiss, pause, resume],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

/** useToast returns the push and dismiss helpers plus the current toast list. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
