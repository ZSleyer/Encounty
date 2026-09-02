/**
 * DetectionLogList.tsx -- Detection log tab of the detector panel sidebar.
 *
 * Lists the confirmed matches newest first, each with its confidence bar,
 * timestamp and counting category.
 */
import { DetectionLogEntry } from "../../types";
import { formatPercent } from "../../utils/format";

/** Renders the detector panel's detection log, newest entry first. */
export function DetectionLogList({
  log,
  precision,
  t,
}: Readonly<{
  log: DetectionLogEntry[] | undefined;
  /** Threshold above which an entry renders as a match. */
  precision: number;
  t: (k: string) => string;
}>) {
  return (
    <div className="space-y-1.5">
      {/* Precision threshold context */}
      {(log?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1 text-[10px] text-text-faint">
          <span>
            {t("detector.precision")}: {formatPercent(precision, 0)}%
          </span>
          <span>·</span>
          <span>
            {log?.length ?? 0} {t("detector.logEntryCount")}
          </span>
        </div>
      )}
      {(() => {
        if (!log || log.length === 0) {
          return (
            <p className="text-xs text-text-muted text-center py-4">{t("detector.noLogEntries")}</p>
          );
        }
        return [...log].reverse().map((entry, i) => {
          const pct = Math.min(entry.confidence * 100, 100);
          const isMatch = entry.confidence >= precision;
          return (
            <div
              key={`log-${entry.at}-${i}`}
              className={`relative rounded-none px-3 py-2 text-xs transition-colors overflow-hidden ${
                isMatch
                  ? "bg-accent-green/8 border border-accent-green/20"
                  : "bg-bg-primary border border-border-subtle"
              }`}
            >
              {/* Confidence bar background */}
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-300 ${
                  isMatch ? "bg-accent-green/10" : "bg-accent-blue/5"
                }`}
                style={{ width: `${pct}%` }}
              />
              {/* Content */}
              <div className="relative flex items-center gap-2">
                {isMatch && <span className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" />}
                <span
                  className={`font-mono font-bold shrink-0 ${
                    isMatch ? "text-accent-green" : "text-text-muted"
                  }`}
                >
                  {pct.toFixed(1)}%
                </span>
                <span className="text-text-faint">·</span>
                <time className="text-text-faint font-mono shrink-0">
                  {new Date(entry.at).toLocaleTimeString()}
                </time>
                {entry.category && (
                  <>
                    <span className="text-text-faint">·</span>
                    <span className="px-1.5 py-0.5 rounded-none bg-accent-blue/15 text-accent-blue font-medium truncate max-w-[40%]">
                      {entry.category}
                    </span>
                  </>
                )}
                <div className="flex-1" />
                {isMatch && (
                  <span className="text-[10px] font-bold text-accent-green uppercase tracking-wider">
                    Match
                  </span>
                )}
              </div>
            </div>
          );
        });
      })()}
    </div>
  );
}
