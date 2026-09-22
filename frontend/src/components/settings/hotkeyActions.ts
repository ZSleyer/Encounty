/**
 * hotkeyActions.ts, the pieces the global and the per-hunt hotkey sections
 * share: the global action table, the write request and the way a rejected
 * write is turned into a message.
 */
import { HotkeyMap } from "../../types";
import { apiUrl } from "../../utils/api";

/** Signature of the translate function handed out by the i18n context. */
type Translate = (key: string, options?: Record<string, string | number>) => string;

/** One global hotkey action and the i18n key of its row label. */
export interface HotkeyAction {
  key: keyof HotkeyMap;
  labelKey: string;
}

/** The global actions, in the order the settings section lists them. */
export const HOTKEY_ACTIONS: HotkeyAction[] = [
  { key: "increment", labelKey: "hotkeys.increment" },
  { key: "decrement", labelKey: "hotkeys.decrement" },
  { key: "reset", labelKey: "hotkeys.reset" },
  { key: "next_pokemon", labelKey: "hotkeys.nextPokemon" },
  { key: "hunt_toggle", labelKey: "hotkeys.huntToggle" },
];

/** The entry already holding a combo, as reported by a 409 response. */
export interface HotkeyOwner {
  kind: "action" | "pokemon" | "group";
  id: string;
  label: string;
}

/** A refused hotkey write, ready to render on the row that was rejected. */
export interface HotkeyRejection {
  /** True when another entry already holds the combo (HTTP 409). */
  conflict: boolean;
  text: string;
}

/** Writes one binding. An empty combo clears it. */
export function writeHotkey(path: string, combo: string): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: combo }),
  });
}

/**
 * Names the holder of a taken combo. The backend labels a global action with
 * its raw action name, which is untranslated, so those are mapped back onto
 * the localized row label; hunts and groups already carry a display name.
 */
function ownerName(owner: HotkeyOwner, t: Translate): string {
  if (owner.kind !== "action") return owner.label;
  const action = HOTKEY_ACTIONS.find((a) => a.key === owner.id || a.key === owner.label);
  return action ? t(action.labelKey) : owner.label;
}

/**
 * Turns a failed hotkey write into the message for the rejected row. A 409
 * names the other holder, anything else falls back to the backend's own error
 * text and finally to the generic "unknown key" string.
 */
export async function readRejection(res: Response, t: Translate): Promise<HotkeyRejection> {
  const data = await res.json().catch(() => ({}));
  const owner = data.owner as HotkeyOwner | undefined;
  if (res.status === 409 && owner) {
    return { conflict: true, text: t("hotkeys.conflictOwner", { label: ownerName(owner, t) }) };
  }
  return { conflict: false, text: data.error ?? t("hotkeys.unknownKey") };
}
