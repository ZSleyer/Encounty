import { useEffect, useRef, useState } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { useToast, Toast } from "../../contexts/ToastContext";
import { useI18n } from "../../contexts/I18nContext";

/** ToastContainer renders the global toast notification stack. */
export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-[clamp(1rem,2.5vw,2.5rem)] right-[clamp(1rem,2.5vw,2.5rem)] z-9999 flex flex-col gap-3 items-end pointer-events-none">
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
  const { pause, resume } = useToast();
  const [leaving, setLeaving] = useState(false);

  // Time (ms) left before the exit animation should start, and the moment
  // the current countdown segment began. Hovering/focusing pauses the
  // countdown by freezing `remaining`; leaving resumes it from there, so a
  // toast that is never touched dismisses at exactly its original duration.
  const remainingRef = useRef(toast.duration ?? (toast.type === "encounter" ? 3000 : 2000));
  const segmentStartRef = useRef(0);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scheduleExit = () => {
    segmentStartRef.current = Date.now();
    const delay = remainingRef.current - 350;
    if (delay > 0) {
      exitTimerRef.current = setTimeout(() => setLeaving(true), delay);
    } else {
      setLeaving(true);
    }
  };

  useEffect(() => {
    scheduleExit();
    return () => clearTimeout(exitTimerRef.current);
    // Runs once on mount; the countdown is self-managed via refs from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePointerPause = () => {
    if (leaving) return; // already dismissing, nothing left to pause
    clearTimeout(exitTimerRef.current);
    const elapsed = Date.now() - segmentStartRef.current;
    remainingRef.current = Math.max(remainingRef.current - elapsed, 0);
    pause(toast.id);
  };

  const handlePointerResume = () => {
    if (leaving) return;
    scheduleExit();
    resume(toast.id);
  };

  const handleDismiss = () => {
    clearTimeout(exitTimerRef.current);
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), 250);
  };

  const animClass = leaving ? "animate-toast-out" : "animate-toast-in";
  const dismissLabel = t("aria.dismissNotification");
  // Error toasts get their own assertive live region so screen reader users
  // get an immediate interruption instead of waiting for a polite queue;
  // every other type keeps the original polite announcement behavior.
  const isError = toast.type === "error";
  const liveRegionProps = isError
    ? ({ role: "alert", "aria-live": "assertive" } as const)
    : ({ role: "status", "aria-live": "polite" } as const);

  if (toast.type === "encounter") {
    return (
      <div
        {...liveRegionProps}
        onMouseEnter={handlePointerPause}
        onMouseLeave={handlePointerResume}
        onFocus={handlePointerPause}
        onBlur={handlePointerResume}
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
          const badge = toast.badge ?? "";
          const getBadgeClass = (b: string): string => {
            if (b === "0") return "text-text-muted bg-bg-secondary";
            if (b === "\u{1F5D1}") return "text-accent-red bg-accent-red/15";
            if (b === "\u2714") return "text-accent-green bg-accent-green/15";
            if (b.startsWith("-")) return "text-accent-yellow bg-accent-yellow/15";
            return "text-accent-blue bg-accent-blue/15";
          };
          const badgeClass = getBadgeClass(badge);
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
      {...liveRegionProps}
      onMouseEnter={handlePointerPause}
      onMouseLeave={handlePointerResume}
      onFocus={handlePointerPause}
      onBlur={handlePointerResume}
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
