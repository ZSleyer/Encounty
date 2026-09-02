/**
 * DexSection.tsx: one generation block of the Pokédex grid.
 */
import { memo, useId } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { DexSlot } from "./DexSlot";
import type { DexGeneration } from "./types";

/** Row height used for the content-visibility size placeholder. */
const ROW_HEIGHT = 112;

interface DexSectionProps {
  readonly block: DexGeneration;
  readonly columns: number;
  readonly activeKey: string | null;
  readonly selectedKey: string | null;
  readonly onOpen: (slotKey: string, dexNumber: number) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLUListElement>) => void;
}

/**
 * One generation of the grid. A real list, not `role="grid"`: CSS
 * auto-placement means DOM rows do not exist, and a list hands out set size
 * and find-in-page for free. The explicit `role="list"` is load-bearing,
 * Safari drops list semantics under `list-style: none`.
 *
 * Memoised, and both key props arrive pre-scoped to this generation (see the
 * render site): a click moves the selection within one block, so the other
 * eight can be skipped instead of walking their slots again. Without the
 * scoping the memo would never bite, since the raw keys change on every click.
 */
export const DexSection = memo(function DexSection({
  block,
  columns,
  activeKey,
  selectedKey,
  onOpen,
  onKeyDown,
}: DexSectionProps) {
  const { t } = useI18n();
  const headingId = useId();
  const rows = Math.ceil(block.slots.length / Math.max(1, columns));

  return (
    <section
      className="dex-section"
      aria-labelledby={headingId}
      style={{ containIntrinsicSize: `auto ${rows * ROW_HEIGHT}px` }}
    >
      {/* The sticky element is this wrapper, not the bar, so the gap below the
          bar is opaque page background rather than a hole the grid scrolls
          through. A margin or a transparent gap cannot do both jobs: it would
          either close the gap or let the slots show in it. */}
      <div className="sticky top-0 z-10 bg-bg-primary pb-2">
        {/* bg-secondary lands within 1.05:1 of a slot card, so a background
            alone gives the bar no edge. border-active carries the separation,
            at 6.1:1 dark and 6.8:1 light, the same accent rule the sidebar
            tabs use. */}
        <h2
          id={headingId}
          className="flex items-baseline gap-3 border-b border-border-active bg-bg-secondary p-4 text-xs font-semibold uppercase tracking-[0.18em] text-text-primary"
        >
          {t("dex.generation", { n: block.generation })}
          <span className={`t-label ${block.caught === block.total ? "t-label--accent" : ""}`}>
            <span className="font-mono tabular-nums">
              {block.caught}/{block.total}
            </span>
          </span>
        </h2>
      </div>
      <ul role="list" className="dex-grid" onKeyDown={onKeyDown}>
        {block.slots.map((slot) => (
          <DexSlot
            key={slot.slotKey}
            slotKey={slot.slotKey}
            dexNumber={slot.id}
            name={slot.name}
            canonical={slot.canonical}
            caught={slot.caught}
            seenOnly={slot.seenOnly}
            selected={slot.slotKey === selectedKey}
            catchCount={slot.catchCount}
            formEntryCount={slot.formEntryCount}
            label={slot.label}
            spriteId={slot.spriteId}
            spriteSlug={slot.spriteSlug}
            gender={slot.gender}
            tabIndex={slot.slotKey === activeKey ? 0 : -1}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
});
