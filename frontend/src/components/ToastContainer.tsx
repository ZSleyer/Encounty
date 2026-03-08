import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { useToast, Toast } from "../contexts/ToastContext";

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-[9999] flex flex-col gap-3 items-end pointer-events-none scale-150 origin-bottom-right">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  if (toast.type === "encounter") {
    return (
      <div
        className="pointer-events-auto flex items-center gap-3 pl-2 pr-4 py-2.5 rounded-2xl glass-card border border-border-subtle shadow-xl animate-toast-in"
        style={{ minWidth: 240 }}
      >
        {toast.spriteUrl && (
          <div className="w-14 h-14 flex items-center justify-center flex-shrink-0">
            <img
              src={toast.spriteUrl}
              alt=""
              className="pokemon-sprite w-14 h-14 object-contain"
            />
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-base font-bold text-text-primary truncate">
            {toast.title}
          </span>
          {toast.message && (
            <span className="text-sm text-text-muted">{toast.message}</span>
          )}
        </div>
        <span
          className={`text-sm font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
            toast.badge === "-1"
              ? "text-accent-yellow bg-accent-yellow/15"
              : toast.badge === "0"
                ? "text-text-muted bg-bg-secondary"
                : toast.badge === "🗑"
                  ? "text-accent-red bg-accent-red/15"
                  : toast.badge === "✔"
                    ? "text-accent-green bg-accent-green/15"
                    : "text-accent-blue bg-accent-blue/15"
          }`}
        >
          {toast.badge || "+1"}
        </span>
        <button
          onClick={() => onDismiss(toast.id)}
          className="ml-1 text-text-faint hover:text-text-muted flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const icons: Record<string, React.ReactNode> = {
    success: (
      <CheckCircle className="w-6 h-6 text-accent-green flex-shrink-0" />
    ),
    error: <AlertCircle className="w-6 h-6 text-accent-red flex-shrink-0" />,
    info: <Info className="w-6 h-6 text-accent-blue flex-shrink-0" />,
  };

  return (
    <div
      className="pointer-events-auto flex items-center gap-4 px-5 py-3.5 rounded-xl glass-card border border-border-subtle shadow-xl animate-toast-in"
      style={{ minWidth: 260 }}
    >
      {icons[toast.type]}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-base font-semibold text-text-primary">
          {toast.title}
        </span>
        {toast.message && (
          <span className="text-sm text-text-muted">{toast.message}</span>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-1 text-text-faint hover:text-text-muted flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
