/**
 * StatisticsPanel — Displays encounter statistics and charts for a single Pokemon.
 * Fetches data from the /api/stats endpoints and renders using recharts.
 */
import { useState, useEffect } from "react";
import { apiUrl } from "../../utils/api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { BarChart3, TrendingUp, Clock, Calendar } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import type { EncounterStats, ChartPoint, EncounterEvent } from "../../types";

interface StatisticsPanelProps {
  readonly pokemonId: string;
}

type ChartInterval = "hour" | "day" | "week";

/** StatisticsPanel shows encounter metrics, a chart, and recent history. */
export function StatisticsPanel({ pokemonId }: Readonly<StatisticsPanelProps>) {
  const { t } = useI18n();
  const [stats, setStats] = useState<EncounterStats | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [history, setHistory] = useState<EncounterEvent[]>([]);
  const [interval, setInterval] = useState<ChartInterval>("day");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
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
  }, [pokemonId, interval]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-8">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={<BarChart3 className="w-4 h-4 text-accent-blue" />}
          label={t("stats.total")}
          value={stats?.total?.toLocaleString() ?? "0"}
        />
        <MetricCard
          icon={<Calendar className="w-4 h-4 text-accent-green" />}
          label={t("stats.today")}
          value={stats?.today?.toLocaleString() ?? "0"}
        />
        <MetricCard
          icon={<TrendingUp className="w-4 h-4 text-accent-yellow" />}
          label={t("stats.ratePerHour")}
          value={stats?.rate_per_hour ? stats.rate_per_hour.toFixed(1) : "—"}
        />
        <MetricCard
          icon={<Clock className="w-4 h-4 text-accent-purple" />}
          label={t("stats.firstEncounter")}
          value={stats?.first_at ? new Date(stats.first_at).toLocaleDateString() : "—"}
        />
      </div>

      {/* Chart */}
      <div className="bg-bg-card border border-border-subtle rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">
            {t("stats.chartTitle")}
          </h3>
          <div className="flex gap-1 bg-bg-secondary rounded-lg p-0.5" role="group" aria-label={t("stats.chartTitle")}>
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
          </div>
        </div>
        {chartData.length > 0 ? (
          <div role="img" aria-label={t("stats.chartTitle")}>
            <ResponsiveContainer width="100%" height={200}>
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
          <div className="flex items-center justify-center h-50 text-text-faint text-sm">
            {t("stats.noData")}
          </div>
        )}
      </div>

      {/* Recent History */}
      <div className="bg-bg-card border border-border-subtle rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          {t("stats.recentHistory")}
        </h3>
        {history.length > 0 ? (
          <div className="space-y-1 max-h-64 overflow-y-auto" role="list">
            {history.map((e) => (
              <div
                key={e.id}
                role="listitem"
                className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-bg-hover text-xs transition-colors"
              >
                <time dateTime={e.timestamp} className="text-text-muted">
                  {new Date(e.timestamp).toLocaleString()}
                </time>
                <span
                  className={`font-mono font-semibold ${
                    e.delta > 0 ? "text-accent-green" : "text-accent-red"
                  }`}
                >
                  {e.delta > 0 ? "+" : ""}
                  {e.delta}
                </span>
                <span className="text-text-secondary tabular-nums">
                  → {e.count_after}
                </span>
                <span className="text-text-faint">{e.source}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-text-faint text-xs">{t("stats.noHistory")}</p>
        )}
      </div>
    </div>
  );
}

// --- MetricCard ---------------------------------------------------------------

function MetricCard({
  icon,
  label,
  value,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  value: string;
}>) {
  return (
    <div className="bg-bg-card border border-border-subtle rounded-xl p-4 flex flex-col items-center text-center">
      <div className="mb-1.5">{icon}</div>
      <div className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-0.5">
        {label}
      </div>
      <div className="text-lg font-black text-text-primary">{value}</div>
    </div>
  );
}
