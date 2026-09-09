/**
 * GroupTotalTime.tsx: accumulated hunt time across a set of group members.
 */
import { Clock } from "lucide-react";
import type { Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useDurationFormat } from "../../contexts/ThemeContext";
import { useSecondTick } from "../../hooks/useSecondTick";
import { runningMsFor } from "../../utils/groupTotals";
import { formatDuration } from "../../utils/timer";

/**
 * GroupTotalTime renders the summed hunt time of `members` and ticks once per
 * second while any of them has a running timer.
 *
 * It is a component rather than a chip inlined into the group header so the
 * per-second re-render stays here instead of rebuilding the member grid below.
 * The accumulated total is passed in clock-free; only the running segment is
 * resolved here.
 */
export function GroupTotalTime({
  members,
  totalTimerMs,
}: Readonly<{ members: Pokemon[]; totalTimerMs: number }>) {
  const { t } = useI18n();
  const { durationFormat } = useDurationFormat();
  const isRunning = members.some((p) => !!p.timer_started_at);

  useSecondTick(isRunning);

  const time = formatDuration(totalTimerMs + runningMsFor(members), durationFormat);
  return (
    <span className="t-label gap-1 tabular-nums" title={t("group.totalTime", { time })}>
      <Clock className="w-3 h-3 text-accent-blue" aria-hidden="true" />
      {time}
      <span className="sr-only">{t("aria.groupTotalTime")}</span>
    </span>
  );
}
