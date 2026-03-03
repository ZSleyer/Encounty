import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { useToast, Toast } from "../contexts/ToastContext";

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
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
        className="pointer-events-auto flex items-center gap-2 pl-1 pr-3 py-1.5 rounded-2xl glass-card border border-border-subtle shadow-lg animate-toast-in"
        style={{ minWidth: 180 }}
      >
        {toast.spriteUrl && (
          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
            <img
              src={toast.spriteUrl}
              alt=""
              className="w-10 h-10 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-white truncate">
            {toast.title}
          </span>
          {toast.message && (
            <span className="text-[10px] text-text-muted">{toast.message}</span>
          )}
        </div>
        <span className="ml-auto text-[10px] font-bold text-accent-blue bg-accent-blue/15 px-1.5 py-0.5 rounded-full flex-shrink-0">
          +1
        </span>
        <button
          onClick={() => onDismiss(toast.id)}
          className="ml-1 text-text-faint hover:text-text-muted flex-shrink-0"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const icons: Record<string, React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 text-accent-green flex-shrink-0" />,
    error: <AlertCircle className="w-4 h-4 text-accent-red flex-shrink-0" />,
    info: <Info className="w-4 h-4 text-accent-blue flex-shrink-0" />,
  };

  return (
    <div
      className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-xl glass-card border border-border-subtle shadow-lg animate-toast-in"
      style={{ minWidth: 160 }}
    >
      {icons[toast.type]}
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-semibold text-white">{toast.title}</span>
        {toast.message && (
          <span className="text-[10px] text-text-muted">{toast.message}</span>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-2 text-text-faint hover:text-text-muted flex-shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
