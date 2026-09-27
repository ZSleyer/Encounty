/**
 * HotkeyKind.tsx, the shared visual language for the two kinds of hotkeys:
 * global keys, which follow whichever hunt or group is the active target, and
 * pinned keys, which always act on the one hunt or group they belong to.
 * Every place that shows a key or a target marks its kind with the same icon,
 * colour and wording, and never with colour alone.
 */
import type { ReactNode } from "react";
import { Globe, Pin } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

/** "global" follows the active target, "entry" is pinned to one hunt or group. */
export type HotkeyKind = "global" | "entry";

/** Border, background and text colour per kind. */
export const HOTKEY_KIND_STYLE: Record<HotkeyKind, string> = {
  global: "border-border-default bg-bg-hover text-text-secondary",
  entry: "border-accent-blue/40 bg-accent-blue/10 text-accent-blue",
};

/** Translation key of the short visible kind name ("Global", "Fest"). */
export const HOTKEY_KIND_LABEL_KEY: Record<HotkeyKind, string> = {
  global: "hotkeys.kind.global",
  entry: "hotkeys.kind.entry",
};

/** Translation key of the one-line meaning of a kind, used as tooltip. */
export const HOTKEY_KIND_DESC_KEY: Record<HotkeyKind, string> = {
  global: "hotkeys.kindDesc.global",
  entry: "hotkeys.kindDesc.entry",
};

/** The icon of a kind. Decorative: the kind is always spelled out as text too. */
export function HotkeyKindIcon({
  kind,
  className = "w-3 h-3",
}: Readonly<{ kind: HotkeyKind; className?: string }>) {
  const Icon = kind === "global" ? Globe : Pin;
  return <Icon aria-hidden="true" className={`shrink-0 ${className}`} />;
}

/**
 * HotkeyKindBadge is the kind marker as a small label: icon plus text. The
 * text defaults to the kind name; callers can pass a longer phrase such as
 * "Global hotkeys active". The tooltip explains what the kind means.
 */
export function HotkeyKindBadge({
  kind,
  children,
  className = "",
}: Readonly<{ kind: HotkeyKind; children?: ReactNode; className?: string }>) {
  const { t } = useI18n();
  return (
    <span
      title={t(HOTKEY_KIND_DESC_KEY[kind])}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] 2xl:text-xs font-semibold leading-none whitespace-nowrap ${HOTKEY_KIND_STYLE[kind]} ${className}`}
    >
      <HotkeyKindIcon kind={kind} />
      {children ?? t(HOTKEY_KIND_LABEL_KEY[kind])}
    </span>
  );
}
