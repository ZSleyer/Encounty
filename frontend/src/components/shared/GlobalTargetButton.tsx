/**
 * GlobalTargetButton.tsx, the sidebar control that makes a hunt or group the
 * target of the global hotkeys. Active, it turns into the global badge, so the
 * current target is marked by icon and text rather than by colour alone.
 */
import { useI18n } from "../../contexts/I18nContext";
import { HOTKEY_KIND_LABEL_KEY, HOTKEY_KIND_STYLE, HotkeyKindIcon } from "./HotkeyKind";

interface GlobalTargetButtonProps {
  /** Whether this hunt or group is the current global target. */
  isTarget: boolean;
  onClick: () => void;
  /** Accessible name and tooltip while inactive, e.g. "Set as target for global hotkeys". */
  label: string;
  /** Accessible name and tooltip while active. */
  activeLabel: string;
}

/**
 * GlobalTargetButton renders a faint globe while inactive and the
 * "[globe] Global" badge while its entry is the global target. Clicks stop
 * here, so they never select the sidebar row behind the button.
 */
export function GlobalTargetButton({
  isTarget,
  onClick,
  label,
  activeLabel,
}: Readonly<GlobalTargetButtonProps>) {
  const { t } = useI18n();
  const name = isTarget ? activeLabel : label;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={isTarget}
      aria-label={name}
      title={name}
      className={`min-w-6 min-h-6 inline-flex items-center justify-center gap-1 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${
        isTarget
          ? `border px-1 text-[10px] 2xl:text-[11px] font-semibold leading-none ${HOTKEY_KIND_STYLE.global}`
          : "text-text-faint hover:text-text-primary"
      }`}
    >
      <HotkeyKindIcon kind="global" className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
      {isTarget && <span>{t(HOTKEY_KIND_LABEL_KEY.global)}</span>}
    </button>
  );
}
