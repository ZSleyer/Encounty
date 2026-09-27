/**
 * EntryHotkeyChip.tsx, the compact pinned-key chip the sidebar shows next to
 * a hunt or group that has its own hotkeys, so a multi-hunt setup can be
 * checked at a glance without opening the hotkey page.
 */
import type { EntryHotkeys } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { boundEntryHotkeys } from "../../utils/hotkeyCombo";
import { HOTKEY_KIND_STYLE, HotkeyKindIcon } from "./HotkeyKind";
import { KeyCombo } from "./KeyCombo";

/**
 * EntryHotkeyChip shows the pin marker with the entry's own +1 key. Every
 * bound action (+1, -1, reset) is listed in the tooltip and in visually hidden
 * text, so the decrement and reset keys are not lost when only the +1 key is
 * drawn. Without a +1 key the pin alone signals that pinned keys exist.
 * Renders nothing while the entry has no own binding.
 *
 * `compact` draws the pin alone, for single-line headers such as a group's in
 * the narrow sidebar: even a plain-text combo squeezed the group name to a few
 * letters there. The tooltip and hidden summary still name every key.
 */
export function EntryHotkeyChip({
  hotkeys,
  compact = false,
}: Readonly<{ hotkeys: EntryHotkeys | undefined; compact?: boolean }>) {
  const { t } = useI18n();
  const bound = boundEntryHotkeys(hotkeys);
  if (bound.length === 0) return null;

  const summary = t("hotkeys.summary", {
    list: bound.map(({ action, combo }) => `${t(`hotkeys.${action}`)} ${combo}`).join(", "),
  });
  const increment = bound.find((b) => b.action === "increment");

  return (
    <span
      className="shrink-0 max-w-28 overflow-hidden inline-flex items-center"
      title={summary}
      data-testid="entry-hotkey-chip"
    >
      {/* The drawn chip would be read without its action, so assistive
          technology gets the full summary below instead. */}
      <span aria-hidden="true" className="inline-flex min-w-0">
        {increment && !compact ? (
          <KeyCombo combo={increment.combo} size="xs" kind="entry" />
        ) : (
          <span className={`inline-flex rounded-sm border px-1 py-0.5 ${HOTKEY_KIND_STYLE.entry}`}>
            <HotkeyKindIcon kind="entry" />
          </span>
        )}
      </span>
      <span className="sr-only">{summary}</span>
    </span>
  );
}
