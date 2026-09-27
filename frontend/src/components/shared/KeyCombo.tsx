/**
 * KeyCombo.tsx, renders a stored key combo as a row of keycaps. Shared by the
 * hotkey settings page and every place in the main UI that shows a binding.
 */
import { Fragment } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { comboParts } from "../../utils/hotkeyCombo";
import { HOTKEY_KIND_LABEL_KEY, HOTKEY_KIND_STYLE, HotkeyKind, HotkeyKindIcon } from "./HotkeyKind";

/** Visual density of the keycaps. */
export type KeyComboSize = "xs" | "sm" | "md";

const KBD_SIZE: Record<KeyComboSize, string> = {
  xs: "px-1 py-px text-[10px]",
  sm: "px-1.5 py-0.5 text-[11px] 2xl:text-xs",
  md: "px-1.5 py-0.5 text-xs 2xl:text-sm",
};

interface KeyComboProps {
  combo: string;
  size?: KeyComboSize;
  /**
   * Marks the combo as a global or a pinned key: the kind's icon and colour
   * frame the keycaps and its name is read out before them, so the kind never
   * depends on colour alone. Omitted where the context already says it.
   */
  kind?: HotkeyKind;
  className?: string;
}

/**
 * KeyCombo shows "Ctrl+F8" as two keycaps joined by a plus. The plus stays in
 * the accessibility tree so a screen reader reads the combo as one phrase.
 */
export function KeyCombo({ combo, size = "md", kind, className = "" }: Readonly<KeyComboProps>) {
  const keys = <Keycaps combo={combo} size={size} />;
  if (!kind) {
    return (
      <span className={`inline-flex items-center gap-0.5 whitespace-nowrap min-w-0 ${className}`}>
        {keys}
      </span>
    );
  }
  return (
    <KindFrame kind={kind} className={className}>
      {keys}
    </KindFrame>
  );
}

/** The keycaps of one combo. */
function Keycaps({ combo, size }: Readonly<{ combo: string; size: KeyComboSize }>) {
  return (
    <>
      {comboParts(combo).map((part, i) => (
        // Keys repeat only in malformed combos, so the index keeps them unique.
        <Fragment key={`${i}-${part}`}>
          {i > 0 && <span className="text-text-faint text-[10px]">+</span>}
          <kbd
            className={`font-mono leading-none tabular-nums rounded-sm border border-border-subtle border-b-2 bg-bg-primary text-text-secondary ${KBD_SIZE[size]}`}
          >
            {part}
          </kbd>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Kind icon, colour and hidden kind name around a combo. It carries no
 * tooltip of its own: callers set one on their container, and a nested title
 * would shadow theirs.
 */
function KindFrame({
  kind,
  className,
  children,
}: Readonly<{ kind: HotkeyKind; className: string; children: React.ReactNode }>) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap min-w-0 rounded-sm border px-0.5 py-px ${HOTKEY_KIND_STYLE[kind]} ${className}`}
    >
      <HotkeyKindIcon kind={kind} className="w-3 h-3 mx-0.5" />
      {/* The separating space is its own text node: a trailing space inside
          the hidden span is trimmed when the accessible text is computed.
          Flex layout ignores it visually. */}
      <span className="sr-only">{t(HOTKEY_KIND_LABEL_KEY[kind])}</span> {children}
    </span>
  );
}
