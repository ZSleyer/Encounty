/**
 * SpeciesFacts.tsx: the aggregate card over every catch of one species.
 */
import { useI18n } from "../../contexts/I18nContext";
import type { GameEntry, Pokemon } from "../../types";
import { Fact } from "./Fact";
import { GameChips } from "./GameChips";
import { completionDate, countForms, distinctGames } from "./dexDetailHelpers";

interface SpeciesFactsProps {
  readonly catches: Pokemon[];
  readonly canonical: string;
  readonly games: GameEntry[];
  readonly languages: string[];
  /** Catches that only reached this slot through an evolution step. */
  readonly evolvedCount: number;
}

/**
 * What the whole slot amounts to: how often, in how many forms, out of which
 * games, and over which stretch of time. The first-catch date is dropped when
 * it would only repeat the last one.
 */
export function SpeciesFacts({
  catches,
  canonical,
  games,
  languages,
  evolvedCount,
}: SpeciesFactsProps) {
  const { t, locale } = useI18n();
  const newest = completionDate(catches[0], locale);
  const oldest = completionDate(catches[catches.length - 1], locale);
  const sources = distinctGames(catches, games, languages);

  const facts = [
    {
      key: "count",
      label: t("dex.catchCount"),
      value: String(catches.length - evolvedCount),
      numeric: true,
    },
    {
      key: "forms",
      label: t("dex.variants"),
      value: String(countForms(catches, canonical, t("dex.defaultForm"))),
      numeric: true,
    },
  ];
  // Only shown once something actually evolved into this slot: on the vast
  // majority of species the fact would be a permanent zero.
  if (evolvedCount > 0) {
    facts.push({
      key: "evolved",
      label: t("dex.evolvedCount"),
      value: String(evolvedCount),
      numeric: true,
    });
  }
  if (oldest && oldest !== newest) {
    facts.push({ key: "first", label: t("dex.firstCatch"), value: oldest, numeric: false });
  }
  if (newest) {
    facts.push({ key: "last", label: t("dex.latestCatch"), value: newest, numeric: false });
  }

  return (
    <div className="t-panel flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        {facts.map((entry) => (
          <Fact key={entry.key} label={entry.label} value={entry.value} numeric={entry.numeric} />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-faint">
          {t("dex.games")}
        </span>
        <GameChips games={sources} />
      </div>
    </div>
  );
}
