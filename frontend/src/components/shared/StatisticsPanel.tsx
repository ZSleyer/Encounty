/**
 * StatisticsPanel — Displays encounter statistics and charts for a single Pokemon.
 * Fetches data from the /api/stats endpoints and renders using recharts.
 */
import { useState, useEffect, useMemo } from "react";
import { apiUrl } from "../../utils/api";
import { useCounterStore } from "../../hooks/useCounterState";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { BarChart3, TrendingUp, Clock, Calendar, Sparkles } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import type { EncounterStats, ChartPoint, EncounterEvent, Pokemon } from "../../types";
import {
  buildProbabilityCurve,
  encountersForProbability,
  getOddsMilestones,
  getOddsPercent,
} from "../../utils/odds";
import { computeTimerMs } from "../../utils/timer";

const MILESTONE_TARGETS = [0.5, 0.75, 0.9, 0.99];

/** Formats an ETA in milliseconds as "2h 15m" / "45m" / "30s". */
function formatEtaMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms <= 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

interface StatisticsPanelProps {
  readonly pokemonId: string;
}

type ChartInterval = "hour" | "day" | "week";

/** StatisticsPanel shows encounter metrics, a chart, and recent history. */
export function StatisticsPanel({ pokemonId }: Readonly<StatisticsPanelProps>) {
  const { t } = useI18n();
  const pokemon = useCounterStore(
    (s) => s.appState?.pokemon.find((p) => p.id === pokemonId) ?? null,
  );
  const encounters = pokemon?.encounters ?? 0;
  const [stats, setStats] = useState<EncounterStats | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [history, setHistory] = useState<EncounterEvent[]>([]);
  const [interval, setInterval] = useState<ChartInterval>("day");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!stats) setLoading(true);
    Promise.all([
      fetch(apiUrl(`/api/stats/pokemon/${pokemonId}`)).then((r) => r.json()),
      fetch(apiUrl(`/api/stats/pokemon/${pokemonId}/chart?interval=${interval}`)).then((r) => r.json()),
      fetch(apiUrl(`/api/stats/pokemon/${pokemonId}/history?limit=20`)).then((r) => r.json()),
    ])
      .then(([s, c, h]) => {
        setStats(s);
        setChartData(c);
        setHistory(h);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pokemonId, interval, encounters]);

  // Encounters per hour is derived from the active hunt duration (accumulated
  // timer), not the calendar span between first and last encounter. An on/off
  // hunt would otherwise report a far too low rate (see issue #35).
  const ratePerHour = useMemo(() => {
    if (!pokemon) return null;
    const hours = computeTimerMs(pokemon) / 3_600_000;
    return hours > 0 ? encounters / hours : null;
  }, [pokemon, encounters]);

  const milestones = useMemo(
    () => getOddsMilestones(pokemon, MILESTONE_TARGETS, ratePerHour ?? undefined),
    [pokemon, ratePerHour],
  );
  const probabilityCurve = useMemo(() => {
    const upper99 = encountersForProbability(pokemon, 0.99);
    const maxN = Math.max(4000, Math.round((upper99 ?? 4000) * 1.2), encounters * 1.2);
    return buildProbabilityCurve(pokemon, maxN, 80);
  }, [pokemon, encounters]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-4 min-h-0 overflow-y-auto">
      {/* Metrics strip */}
      <div className="bg-bg-card border border-border-subtle rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-around gap-y-2 gap-x-3 shrink-0">
        <MetricItem icon={<BarChart3 className="w-3.5 h-3.5 text-accent-blue" />} label={t("stats.total")} value={stats?.total?.toLocaleString() ?? "0"} />
        <div className="hidden md:block w-px h-5 bg-border-subtle" aria-hidden="true" />
        <MetricItem icon={<Calendar className="w-3.5 h-3.5 text-accent-green" />} label={t("stats.today")} value={stats?.today?.toLocaleString() ?? "0"} />
        <div className="hidden md:block w-px h-5 bg-border-subtle" aria-hidden="true" />
        <MetricItem icon={<TrendingUp className="w-3.5 h-3.5 text-accent-yellow" />} label={t("stats.ratePerHour")} value={ratePerHour ? ratePerHour.toFixed(1) : "—"} />
        <div className="hidden md:block w-px h-5 bg-border-subtle" aria-hidden="true" />
        <MetricItem icon={<Sparkles className="w-3.5 h-3.5 text-accent-pink" />} label={t("stats.shinyChance")} value={getOddsPercent(pokemon)} />
        <div className="hidden md:block w-px h-5 bg-border-subtle" aria-hidden="true" />
        <MetricItem icon={<Clock className="w-3.5 h-3.5 text-accent-purple" />} label={t("stats.firstEncounter")} value={stats?.first_at && stats.total > 0 ? new Date(stats.first_at).toLocaleDateString() : "—"} />
      </div>

      {/* Chart + History side-by-side, both fill height */}
      <div className="flex-1 grid grid-cols-[2fr_1fr] gap-4 min-h-0">
        {/* Chart */}
        <div className="bg-bg-card border border-border-subtle rounded-2xl p-5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h3 className="text-sm font-semibold text-text-primary">
              {t("stats.chartTitle")}
            </h3>
            <fieldset className="flex gap-1 bg-bg-secondary rounded-lg p-0.5 border-0 m-0" aria-label={t("stats.chartTitle")}>
              {(["hour", "day", "week"] as ChartInterval[]).map((iv) => (
                <button
                  key={iv}
                  onClick={() => setInterval(iv)}
                  aria-pressed={interval === iv}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    interval === iv
                      ? "bg-accent-blue text-white"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {t(`stats.interval.${iv}`)}
                </button>
              ))}
            </fieldset>
          </div>
          {chartData.length > 0 ? (
            <div role="img" aria-label={t("stats.chartTitle")} className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v: string) => {
                      if (interval === "hour") return v.slice(11, 16);
                      if (interval === "week") return v;
                      return v.slice(5);
                    }}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1 min-h-0 text-text-faint text-sm">
              {t("stats.noData")}
            </div>
          )}
        </div>

        {/* Recent History */}
        <div className="bg-bg-card border border-border-subtle rounded-2xl p-5 flex flex-col min-h-0">
          <h3 className="text-sm font-semibold text-text-primary mb-3 shrink-0">
            {t("stats.recentHistory")}
          </h3>
          {history.length > 0 ? (
            <div className="overflow-y-auto flex-1 min-h-0">
              <table className="w-full text-xs" aria-label={t("stats.recentHistory")}>
                <thead className="sticky top-0 bg-bg-card">
                  <tr className="border-b border-border-subtle text-text-muted font-semibold">
                    <th className="text-left py-1.5 px-2 font-semibold">{t("stats.colTime")}</th>
                    <th className="text-right py-1.5 px-2 font-semibold">{t("stats.colChange")}</th>
                    <th className="text-right py-1.5 px-2 font-semibold">{t("stats.colCount")}</th>
                    <th className="text-right py-1.5 px-2 font-semibold">{t("stats.colSource")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((e) => (
                    <tr key={e.id} className="hover:bg-bg-hover transition-colors">
                      <td className="py-1.5 px-2 text-text-muted whitespace-nowrap">
                        <time dateTime={e.timestamp}>{new Date(e.timestamp).toLocaleString()}</time>
                      </td>
                      <td className={`py-1.5 px-2 text-right font-mono font-semibold ${e.delta > 0 ? "text-accent-green" : "text-accent-red"}`}>
                        {e.delta > 0 ? "+" : ""}{e.delta}
                      </td>
                      <td className="py-1.5 px-2 text-right text-text-secondary tabular-nums">
                        {e.count_after}
                      </td>
                      <td className="py-1.5 px-2 text-right text-text-faint">
                        {e.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-text-faint text-xs">{t("stats.noHistory")}</p>
          )}
        </div>
      </div>

      {/* Probability curve + milestones */}
      <ProbabilityPanel
        pokemon={pokemon}
        curve={probabilityCurve}
        milestones={milestones}
        currentEncounters={encounters}
      />
    </div>
  );
}

// --- ProbabilityPanel --------------------------------------------------------

interface ProbabilityPanelProps {
  readonly pokemon: Pokemon | null;
  readonly curve: { n: number; p: number }[];
  readonly milestones: ReturnType<typeof getOddsMilestones>;
  readonly currentEncounters: number;
}

/**
 * Renders the cumulative shiny probability curve and the target milestone
 * table with optional ETA. Hidden when the pokemon has no resolvable odds
 * (no game set, etc.), because both curve and table would be empty.
 */
function ProbabilityPanel({
  pokemon,
  curve,
  milestones,
  currentEncounters,
}: ProbabilityPanelProps) {
  const { t } = useI18n();
  if (!pokemon || curve.length === 0) return null;

  const chartData = curve.map((pt) => ({ n: pt.n, percent: pt.p * 100 }));

  return (
    <div className="grid grid-cols-[2fr_1fr] gap-4 shrink-0">
      <div className="bg-bg-card border border-border-subtle rounded-2xl p-5 flex flex-col min-h-65">
        <h3 className="text-sm font-semibold text-text-primary mb-3 shrink-0">
          {t("stats.probabilityTitle")}
        </h3>
        <div
          role="img"
          aria-label={t("stats.probabilityAria")}
          data-testid="probability-chart"
          className="flex-1 min-h-0"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="n"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={(v: number) => v.toLocaleString()}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                width={40}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e293b",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(v) => `${Number(v).toFixed(1)}%`}
                labelFormatter={(v) => Number(v).toLocaleString()}
              />
              <ReferenceLine y={50} stroke="rgba(148,163,184,0.3)" strokeDasharray="2 2" />
              <ReferenceLine y={90} stroke="rgba(148,163,184,0.3)" strokeDasharray="2 2" />
              <ReferenceLine y={99} stroke="rgba(148,163,184,0.3)" strokeDasharray="2 2" />
              <ReferenceLine
                x={currentEncounters}
                stroke="#ec4899"
                strokeWidth={2}
                label={{
                  value: t("stats.currentMarker"),
                  position: "top",
                  fill: "#ec4899",
                  fontSize: 10,
                }}
              />
              <Line
                type="monotone"
                dataKey="percent"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-bg-card border border-border-subtle rounded-2xl p-5 flex flex-col min-h-65">
        <h3 className="text-sm font-semibold text-text-primary mb-3 shrink-0">
          {t("stats.milestonesTitle")}
        </h3>
        <table className="w-full text-xs" aria-label={t("stats.milestonesTitle")}>
          <thead>
            <tr className="border-b border-border-subtle text-text-muted font-semibold">
              <th className="text-left py-1.5 px-2 font-semibold">{t("stats.colTarget")}</th>
              <th className="text-right py-1.5 px-2 font-semibold">{t("stats.colEncounters")}</th>
              <th className="text-right py-1.5 px-2 font-semibold">{t("stats.colEta")}</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.target} className="border-b border-border-subtle/40 last:border-0">
                <td className="py-1.5 px-2 text-text-secondary tabular-nums">
                  {Math.round(m.target * 100)}%
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums font-mono text-text-primary">
                  {m.encounters?.toLocaleString() ?? "—"}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-muted">
                  {m.etaMs === 0 ? t("stats.etaReached") : formatEtaMs(m.etaMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- MetricItem --------------------------------------------------------------

function MetricItem({
  icon,
  label,
  value,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  value: string;
}>) {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 opacity-60">{icon}</div>
      <span className="text-sm font-bold text-text-primary tabular-nums">{value}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  );
}
