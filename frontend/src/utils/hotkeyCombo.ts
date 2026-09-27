/**
 * hotkeyCombo.ts, helpers for presenting stored key combos: splitting a combo
 * into keycaps and summarising the per-entry bindings of a hunt or group.
 */
import type { EntryHotkeyAction, EntryHotkeys } from "../types";

/** The counter actions a single hunt or group can bind, in display order. */
export const ENTRY_HOTKEY_ACTIONS: readonly EntryHotkeyAction[] = [
  "increment",
  "decrement",
  "reset",
];

/**
 * Splits a stored combo such as "Ctrl+Shift+F8" into its keys. The plus key
 * itself is a valid main key ("Ctrl++"), so only a "+" that is followed by
 * another character counts as a separator.
 */
export function comboParts(combo: string): string[] {
  return combo.split(/\+(?=.)/).filter(Boolean);
}

/** One bound action of an entry. */
export interface BoundEntryHotkey {
  action: EntryHotkeyAction;
  combo: string;
}

/** The bound actions of an entry in display order; unbound ones are left out. */
export function boundEntryHotkeys(hotkeys: EntryHotkeys | undefined): BoundEntryHotkey[] {
  return ENTRY_HOTKEY_ACTIONS.flatMap((action) => {
    const combo = hotkeys?.[action]?.trim() ?? "";
    return combo ? [{ action, combo }] : [];
  });
}

/**
 * Converts a stored combo into the `aria-keyshortcuts` syntax, which spells
 * the control modifier out as "Control".
 */
export function toAriaKeyShortcuts(combo: string): string {
  return comboParts(combo)
    .map((part) => (part === "Ctrl" ? "Control" : part))
    .join("+");
}
