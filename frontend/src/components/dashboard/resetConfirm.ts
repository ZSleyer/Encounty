/**
 * resetConfirm.ts: Confirmation dialog for a reset requested from outside.
 *
 * A global hotkey or the overlay can ask for a counter reset while the window
 * is in the background; the request arrives over the WebSocket and has to be
 * confirmed in the UI before anything is zeroed.
 */

import { Pokemon } from "../../types";

/** Builds a confirmation dialog config for a reset request, or null if the message is not a reset. */
function buildResetConfirmConfig(
  msg: { type: string; payload: unknown },
  pokemon: Pokemon[],
  t: (key: string) => string,
  onConfirm: (pokemonId: string) => void,
  onConfirmGroup: (groupId: string) => void,
): {
  isOpen: boolean;
  title: string;
  message: string;
  isDestructive: boolean;
  onConfirm: () => void;
} | null {
  if (msg.type === "request_reset_confirm") {
    const payload = msg.payload as { pokemon_id: string };
    const match = pokemon.find((p) => p.id === payload.pokemon_id);
    const nameSuffix = match ? ` (${match.name})` : "";
    return {
      isOpen: true,
      title: t("confirm.resetTitle"),
      message: `${t("confirm.resetMsg")}${nameSuffix}`,
      isDestructive: true,
      onConfirm: () => onConfirm(payload.pokemon_id),
    };
  }
  if (msg.type === "request_group_reset_confirm") {
    const payload = msg.payload as { group_id: string };
    return {
      isOpen: true,
      title: t("confirm.resetTitle"),
      message: t("confirm.resetGroupMsg"),
      isDestructive: true,
      onConfirm: () => onConfirmGroup(payload.group_id),
    };
  }
  return null;
}

/** Processes a WebSocket message and shows a reset confirmation dialog if appropriate. */
export function handleResetConfirmMessage(
  msg: { type: string; payload: unknown },
  pokemon: Pokemon[] | undefined,
  t: (key: string) => string,
  send: (type: string, payload: unknown) => void,
  setConfirmConfig: React.Dispatch<
    React.SetStateAction<{
      isOpen: boolean;
      title: string;
      message: string;
      isDestructive: boolean;
      onConfirm: () => void;
    }>
  >,
): void {
  const config = buildResetConfirmConfig(
    msg,
    pokemon ?? [],
    t,
    (pokemonId) => send("reset", { pokemon_id: pokemonId }),
    (groupId) => send("reset_group", { group_id: groupId }),
  );
  if (config) {
    globalThis.electronAPI?.focusWindow();
    setConfirmConfig(config);
  }
}
