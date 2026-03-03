import { createContext, useContext, useState, useCallback, useRef } from "react";

export type ToastType = "success" | "error" | "info" | "encounter";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  spriteUrl?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
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

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
