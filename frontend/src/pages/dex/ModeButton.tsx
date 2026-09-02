/**
 * ModeButton.tsx: the national/game switch of the Pokédex toolbar.
 */
interface ModeButtonProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

/**
 * Mode switch. Two pressed-state buttons rather than a tablist: both states
 * show the very same panel, only its numbers change.
 */
export function ModeButton({ active, onClick, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[28px] rounded-none border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${
        active
          ? "border-accent-blue/50 bg-accent-blue/10 text-accent-blue"
          : "border-border-subtle text-text-muted hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
