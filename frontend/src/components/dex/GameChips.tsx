/**
 * GameChips.tsx: the source-game chip row of the Pokédex species facts.
 */
import { useI18n } from "../../contexts/I18nContext";

/**
 * Games named as chips before the rest collapses into a count. Three keeps the
 * row on one line even in the ~340px side panel, and the newest games are the
 * ones a hunter is still playing.
 */
const GAME_CHIP_LIMIT = 3;

interface GameChipsProps {
  readonly games: { key: string; label: string }[];
}

/** The source games of a species, collapsed to the newest few plus a count. */
export function GameChips({ games }: GameChipsProps) {
  const { t } = useI18n();
  const shown = games.slice(0, GAME_CHIP_LIMIT);
  const hidden = games.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((game) => (
        <span key={game.key} className="t-label">
          {game.label}
        </span>
      ))}
      {hidden > 0 && (
        <span className="t-label tabular-nums">{t("dex.moreGames", { count: hidden })}</span>
      )}
    </div>
  );
}
