/**
 * hotkeyActions.ts, the pieces the global and the per-hunt hotkey sections
 * share: the global action table, which hunts can be bound or targeted, the
 * write request and the way a rejected write is turned into a message.
 */
import { HotkeyMap, Pokemon } from "../../types";
import { apiUrl } from "../../utils/api";
import { isPhaseEntry } from "../../utils/phase";
import { formatGame, getBaseAndFormName } from "../dashboard/presentation";

/** Signature of the translate function handed out by the i18n context. */
export type Translate = (key: string, options?: Record<string, string | number>) => string;

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

/**
 * A hunt can be bound or made the global target while it is still being
 * hunted. Finished, failed and frozen phase entries are excluded: their
 * counter no longer moves.
 */
export function isRunningHunt(p: Pokemon): boolean {
  return !p.completed_at && !p.failed && !isPhaseEntry(p);
}

/**
 * Name and secondary line of a hunt as the sidebar shows them: the nickname,
 * else the species, then form or species behind a nickname and the game.
 * The secondary line is what tells two same-species hunts apart.
 */
export function huntIdentity(p: Pokemon): { name: string; meta: string } {
  const [name, secondary] = getBaseAndFormName(p);
  const meta = [secondary, p.game ? formatGame(p.game) : ""].filter(Boolean).join(" · ");
  return { name, meta };
}

/** The entry already holding a combo, as reported by a 409 response. */
export interface HotkeyOwner {
  kind: "action" | "pokemon" | "group";
  id: string;
  label: string;
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
 * Turns a failed hotkey write into the message text for the rejected row. A 409
 * names the other holder. The backend's own error text is English and
 * technical, so any other refusal gets a localized message instead: a 400 is
 * a combo the backend cannot parse, everything else a generic save failure.
 */
export async function readRejection(res: Response, t: Translate): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const owner = data.owner as HotkeyOwner | undefined;
  if (res.status === 409 && owner) {
    return t("hotkeys.conflictOwner", { label: ownerName(owner, t) });
  }
  return res.status === 400 ? t("hotkeys.unknownKey") : t("hotkeys.saveFailed");
}
