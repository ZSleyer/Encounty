import { useEffect, useState } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { useToast, Toast } from "../../contexts/ToastContext";

/** ToastContainer renders the global toast notification stack. */
export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-9999 flex flex-col gap-3 items-end pointer-events-none 2xl:bottom-10 2xl:right-10">
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
  const [leaving, setLeaving] = useState(false);

  // Auto-dismiss with exit animation
  useEffect(() => {
    const duration = toast.duration ?? (toast.type === "encounter" ? 3000 : 2000);
    const exitTimer = setTimeout(() => setLeaving(true), duration - 300);
    return () => clearTimeout(exitTimer);
  }, [toast.duration, toast.type]);

  const handleDismiss = () => {
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  const animClass = leaving ? "animate-toast-out" : "animate-toast-in";

  if (toast.type === "encounter") {
    return (
      <div
        className={`pointer-events-auto flex items-center gap-4 pl-4 pr-4 py-3 rounded-2xl bg-bg-secondary/95 backdrop-blur-md border border-border-subtle shadow-lg ${animClass} min-w-85 max-w-110 2xl:min-w-100 2xl:max-w-125 2xl:gap-5 2xl:pl-5 2xl:pr-5 2xl:py-4`}
      >
        {toast.spriteUrl && (
          <div className="w-14 h-14 flex items-center justify-center shrink-0 2xl:w-16 2xl:h-16">
            <img
              src={toast.spriteUrl}
              alt=""
              className="pokemon-sprite w-14 h-14 object-contain 2xl:w-16 2xl:h-16"
            />
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-base font-bold text-text-primary truncate 2xl:text-lg">
            {toast.title}
          </span>
          {toast.message && (
            <span className="text-sm text-text-muted 2xl:text-base">{toast.message}</span>
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
              className={`text-sm font-bold px-3 py-1 rounded-full shrink-0 2xl:text-base 2xl:px-3.5 ${badgeClass}`}
            >
              {toast.badge || "+1"}
            </span>
          );
        })()}
        <button
          onClick={handleDismiss}
          className="text-text-faint hover:text-text-muted shrink-0 p-1"
        >
          <X className="w-4 h-4 2xl:w-5 2xl:h-5" />
        </button>
      </div>
    );
  }

  const icons: Record<string, React.ReactNode> = {
    success: <CheckCircle className="w-6 h-6 text-accent-green shrink-0 2xl:w-7 2xl:h-7" />,
    error: <AlertCircle className="w-6 h-6 text-accent-red shrink-0 2xl:w-7 2xl:h-7" />,
    info: <Info className="w-6 h-6 text-accent-blue shrink-0 2xl:w-7 2xl:h-7" />,
  };

  return (
    <div
      className={`pointer-events-auto flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-bg-secondary/95 backdrop-blur-md border border-border-subtle shadow-lg ${animClass} min-w-85 max-w-110 2xl:min-w-100 2xl:max-w-125 2xl:gap-5 2xl:px-6 2xl:py-4`}
    >
      {icons[toast.type]}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-base font-semibold text-text-primary 2xl:text-lg">
          {toast.title}
        </span>
        {toast.message && (
          <span className="text-sm text-text-muted 2xl:text-base">{toast.message}</span>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="text-text-faint hover:text-text-muted shrink-0 p-1"
      >
        <X className="w-4 h-4 2xl:w-5 2xl:h-5" />
      </button>
    </div>
  );
}
