/**
 * Fact.tsx: the labeled key/value pair every Pokédex detail card is built of.
 *
 * Shared by the catch card, its phase history and the aggregate species facts,
 * so the three read as one grid even though they compute their values from
 * completely different sources.
 */
interface FactProps {
  readonly label: string;
  readonly value: string;
  /** Counts render tabular so a column of them keeps its digits aligned. */
  readonly numeric?: boolean;
}

/** One labeled fact inside a card. */
export function Fact({ label, value, numeric = false }: FactProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-text-faint">{label}</span>
      <span className={`text-sm text-text-secondary ${numeric ? "tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  );
}
