/**
 * ToastContext.tsx — Toast notification system.
 *
 * Non-error toasts auto-dismiss after a per-type duration (see DURATIONS).
 * Error toasts are persistent: they have no auto-dismiss timer and stay until
 * the user closes them manually or the underlying condition is resolved via
 * dismissByKey(). When a toast carrying a `key` (or an encounter toast for the
 * same sprite) already exists it is replaced in-place rather than stacked, so
 * repeated identical statuses only show one toast at a time. The stack is
 * capped at 5.
 */
import { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";

export type ToastType = "success" | "error" | "info" | "encounter";

/** Default auto-dismiss duration per type, in milliseconds. A value of 0 means
 * the toast is persistent (no timer): errors stay until resolved or closed. */
const DURATIONS: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  encounter: 3000,
  error: 0,
};

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  spriteUrl?: string;
  badge?: string;
  duration?: number;
  /** Stable identity for a status: pushing another toast with the same key
   * replaces this one, and dismissByKey(key) removes it once the underlying
   * condition is resolved (e.g. a capture source finally selected). */
  key?: string;
}

interface ToastContextType {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
  /** dismissByKey removes every toast carrying the given key, used to clear a
   * persistent error once the user has fixed its cause. */
  dismissByKey: (key: string) => void;
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

  const dismissByKey = useCallback((key: string) => {
    setToasts((prev) => {
      for (const t of prev) {
        if (t.key !== key) continue;
        const entry = timers.current.get(t.id);
        if (entry?.handle) clearTimeout(entry.handle);
        timers.current.delete(t.id);
      }
      return prev.filter((t) => t.key !== key);
    });
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
      const duration = toast.duration ?? DURATIONS[toast.type];
      // Resolve duration onto the toast so the container never recomputes it.
      const resolved: Toast = { ...toast, id, duration };
      // duration <= 0 means persistent: no auto-dismiss timer is scheduled.
      const scheduleIfTimed = (toastId: string) => {
        if (duration > 0) scheduleTimer(toastId, duration);
      };

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
        // Replace an existing toast that shares this one's identity, so repeated
        // statuses do not stack: an explicit `key`, or an encounter for the same
        // sprite (its implicit key).
        const existing = prev.find((t) =>
          toast.key !== undefined
            ? t.key === toast.key
            : toast.type === "encounter" &&
              t.type === "encounter" &&
              t.spriteUrl === toast.spriteUrl,
        );
        if (existing) {
          const oldEntry = timers.current.get(existing.id);
          if (oldEntry?.handle) clearTimeout(oldEntry.handle);
          timers.current.delete(existing.id);
          scheduleIfTimed(id);
          return prev.map((t) => (t.id === existing.id ? resolved : t));
        }
        // ponytail: max 5 toasts; a persistent error can be evicted when the
        // stack overflows. Acceptable ceiling, raise only if it bites.
        const next = prev.length >= 5 ? prev.slice(1) : prev;
        scheduleIfTimed(id);
        return [...next, resolved];
      });
    },
    [scheduleTimer],
  );

  const value = useMemo(
    () => ({ toasts, push, dismiss, dismissByKey, pause, resume }),
    [toasts, push, dismiss, dismissByKey, pause, resume],
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
