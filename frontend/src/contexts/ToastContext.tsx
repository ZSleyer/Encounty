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
}

const ToastContext = createContext<ToastContextType | null>(null);

/** ToastProvider supplies the toast queue and push/dismiss actions to the tree. */
export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      const duration = toast.duration ?? (toast.type === "encounter" ? 3000 : 2000);

      // Show system notification when the page is hidden (minimized / background tab)
      if (document.hidden && "Notification" in window) {
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
            clearTimeout(timers.current.get(existing.id));
            timers.current.delete(existing.id);
            const timer = setTimeout(() => dismiss(id), duration);
            timers.current.set(id, timer);
            return prev.map((t) =>
              t.id === existing.id ? { ...toast, id } : t,
            );
          }
        }
        // Keep max 5 toasts
        const next = prev.length >= 5 ? prev.slice(1) : prev;
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
        return [...next, { ...toast, id }];
      });
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

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
