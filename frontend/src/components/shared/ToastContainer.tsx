import { useEffect, useState } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { useToast, Toast } from "../../contexts/ToastContext";
import { useI18n } from "../../contexts/I18nContext";

/** ToastContainer renders the global toast notification stack. */
export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[clamp(1rem,2.5vw,2.5rem)] right-[clamp(1rem,2.5vw,2.5rem)] z-9999 flex flex-col gap-3 items-end pointer-events-none"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: Readonly<{
  toast: Toast;
  onDismiss: (id: string) => void;
}>) {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const duration = toast.duration ?? (toast.type === "encounter" ? 3000 : 2000);
    const exitTimer = setTimeout(() => setLeaving(true), duration - 350);
    return () => clearTimeout(exitTimer);
  }, [toast.duration, toast.type]);

  const handleDismiss = () => {
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), 250);
  };

  const animClass = leaving ? "animate-toast-out" : "animate-toast-in";
  const dismissLabel = t("aria.dismissNotification");

  if (toast.type === "encounter") {
    return (
      <div
        className={`pointer-events-auto flex items-center gap-[clamp(0.875rem,1.2vw,1.25rem)] px-[clamp(0.875rem,1.2vw,1.25rem)] py-[clamp(0.625rem,0.9vw,1rem)] rounded-2xl bg-bg-secondary/95 backdrop-blur-md border border-border-subtle shadow-lg ${animClass} w-[clamp(320px,28vw,480px)]`}
      >
        {toast.spriteUrl && (
          <div className="w-[clamp(3rem,3.5vw,4rem)] h-[clamp(3rem,3.5vw,4rem)] flex items-center justify-center shrink-0">
            <img
              src={toast.spriteUrl}
              alt=""
              className="pokemon-sprite w-[clamp(3rem,3.5vw,4rem)] h-[clamp(3rem,3.5vw,4rem)] object-contain"
            />
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[clamp(0.875rem,1vw,1.125rem)] font-bold text-text-primary truncate">
            {toast.title}
          </span>
          {toast.message && (
            <span className="text-[clamp(0.8125rem,0.9vw,1rem)] text-text-muted">{toast.message}</span>
          )}
        </div>
        {(() => {
          const badgeStyles: Record<string, string> = {
            "-1": "text-accent-yellow bg-accent-yellow/15",
            "0": "text-text-muted bg-bg-secondary",
            "\u{1F5D1}": "text-accent-red bg-accent-red/15",
            "\u2714": "text-accent-green bg-accent-green/15",
          };
          const badgeClass = badgeStyles[toast.badge ?? ""] ?? "text-accent-blue bg-accent-blue/15";
          return (
            <span
              className={`text-[clamp(0.8125rem,0.9vw,1rem)] font-bold px-3 py-1 rounded-full shrink-0 ${badgeClass}`}
            >
              {toast.badge || "+1"}
            </span>
          );
        })()}
        <button
          onClick={handleDismiss}
          aria-label={dismissLabel}
          className="text-text-faint hover:text-text-muted shrink-0 p-1"
        >
          <X className="w-[clamp(1rem,1.1vw,1.25rem)] h-[clamp(1rem,1.1vw,1.25rem)]" />
        </button>
      </div>
    );
  }

  const icons: Record<string, React.ReactNode> = {
    success: <CheckCircle className="w-[clamp(1.375rem,1.6vw,1.75rem)] h-[clamp(1.375rem,1.6vw,1.75rem)] text-accent-green shrink-0" />,
    error: <AlertCircle className="w-[clamp(1.375rem,1.6vw,1.75rem)] h-[clamp(1.375rem,1.6vw,1.75rem)] text-accent-red shrink-0" />,
    info: <Info className="w-[clamp(1.375rem,1.6vw,1.75rem)] h-[clamp(1.375rem,1.6vw,1.75rem)] text-accent-blue shrink-0" />,
  };

  return (
    <div
      className={`pointer-events-auto flex items-center gap-[clamp(0.875rem,1.2vw,1.25rem)] px-[clamp(1rem,1.4vw,1.5rem)] py-[clamp(0.75rem,1vw,1rem)] rounded-2xl bg-bg-secondary/95 backdrop-blur-md border border-border-subtle shadow-lg ${animClass} w-[clamp(320px,28vw,480px)]`}
    >
      {icons[toast.type]}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[clamp(0.875rem,1vw,1.125rem)] font-semibold text-text-primary">
          {toast.title}
        </span>
        {toast.message && (
          <span className="text-[clamp(0.8125rem,0.9vw,1rem)] text-text-muted">{toast.message}</span>
        )}
      </div>
      <button
        onClick={handleDismiss}
        aria-label={dismissLabel}
        className="text-text-faint hover:text-text-muted shrink-0 p-1"
      >
        <X className="w-[clamp(1rem,1.1vw,1.25rem)] h-[clamp(1rem,1.1vw,1.25rem)]" />
      </button>
    </div>
  );
}
