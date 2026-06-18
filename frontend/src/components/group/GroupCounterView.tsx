/**
 * GroupCounterView.tsx — Main-panel view for the currently active group.
 *
 * Shown in the Dashboard main panel when no single Pokémon is the active or
 * viewed target but a group IS active. It renders the group's members in a
 * responsive grid (reusing PokemonCard) so the panel is never empty, plus a
 * header with the group identity and bulk increment/decrement/reset actions.
 *
 * Bulk reset confirmation is the parent's responsibility: this component only
 * forwards the onBulkReset callback.
 */
import { Plus, Minus, RotateCcw, Zap } from "lucide-react";
import type { Group, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { PokemonCard } from "../pokemon/PokemonCard";

/** Fallback dot colour used when a group has no colour configured. */
const DEFAULT_GROUP_COLOR = "#6b7280";

type Props = Readonly<{
  group: Group;
  /** Members already filtered to this group; passed through as given. */
  members: Pokemon[];
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onReset: (id: string) => void;
  onEdit: (pokemon: Pokemon) => void;
  /** Open a member's auto-detection tab from its live preview. */
  onOpenDetector: (id: string) => void;
  /** Increment every member of the group. */
  onBulkIncrement: () => void;
  /** Decrement every member of the group. */
  onBulkDecrement: () => void;
  /** Reset every member of the group. Confirmation is handled by the parent. */
  onBulkReset: () => void;
}>;

/**
 * Renders the active group's header (colour dot, name, member count, bulk
 * actions) followed by a responsive grid of PokemonCard items, or an empty
 * state message when the group has no members.
 */
export function GroupCounterView({
  group,
  members,
  onIncrement,
  onDecrement,
  onReset,
  onEdit,
  onOpenDetector,
  onBulkIncrement,
  onBulkDecrement,
  onBulkReset,
}: Props) {
  const { t } = useI18n();
  const dotColor = group.color || DEFAULT_GROUP_COLOR;
  const totalEncounters = members.reduce((sum, p) => sum + p.encounters, 0);

  // Shared button styling: visible focus ring + accessible hit area.
  const bulkButtonClass =
    "flex items-center justify-center w-9 h-9 rounded-lg bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";

  return (
    <section aria-label={group.name} className="flex flex-col h-full min-h-0">
      {/* --- Header --- fixed bar; only the member grid below scrolls, so the
          bulk actions stay reachable and nothing clips through the top. */}
      <header className="shrink-0 px-4 md:px-6 py-3 bg-bg-card border-b border-border-subtle">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Group identity with a colour accent bar. */}
          <span
            aria-hidden="true"
            className="w-1.5 h-7 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
          <h2 className="text-2xl font-bold text-text-primary truncate min-w-0">
            {group.name}
          </h2>

          {/* Stat chips: member count + summed encounters. */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-bg-secondary border border-border-subtle text-text-secondary tabular-nums">
              {t("group.count", { count: members.length })}
            </span>
            <span
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-bg-secondary border border-border-subtle text-text-secondary tabular-nums"
              title={t("group.totalEncounters", { count: totalEncounters })}
            >
              <Zap className="w-3 h-3 text-accent-yellow" aria-hidden="true" />
              {totalEncounters.toLocaleString()}
            </span>
          </div>

          {/* Bulk actions */}
          <div
            role="group"
            aria-label={group.name}
            className="flex items-center gap-2 ml-auto"
          >
            <button
              type="button"
              onClick={onBulkIncrement}
              className={bulkButtonClass}
              title={t("group.bulkIncrement")}
              aria-label={t("group.bulkIncrement")}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onBulkDecrement}
              className={bulkButtonClass}
              title={t("group.bulkDecrement")}
              aria-label={t("group.bulkDecrement")}
            >
              <Minus className="w-4 h-4" aria-hidden="true" />
            </button>
            <span aria-hidden="true" className="w-px h-5 bg-border-subtle mx-0.5" />
            <button
              type="button"
              onClick={onBulkReset}
              className={`${bulkButtonClass} hover:text-red-400`}
              title={t("group.bulkReset")}
              aria-label={t("group.bulkReset")}
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* --- Members --- only this region scrolls. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
        {members.length === 0 ? (
          <p className="text-sm text-text-muted py-12 text-center">
            {t("group.empty")}
          </p>
        ) : (
          <ul className="grid gap-4 justify-center grid-cols-[repeat(auto-fill,minmax(240px,300px))] list-none p-0 m-0">
            {members.map((pokemon) => (
              <li key={pokemon.id}>
                <PokemonCard
                  pokemon={pokemon}
                  onIncrement={onIncrement}
                  onDecrement={onDecrement}
                  onReset={onReset}
                  onEdit={onEdit}
                  onOpenDetector={onOpenDetector}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
