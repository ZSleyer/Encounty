/**
 * useOverlayUpdate.ts: Hook that persists a hunt's overlay mode and settings.
 */

import { AppState, OverlayMode, OverlaySettings } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { apiUrl } from "../../utils/api";

/** Hook that returns a callback to update a Pokemon's overlay_mode and settings via the API. */
export function useOverlayUpdate(
  appState: AppState,
  setOverlayDirty: (dirty: boolean) => void,
  setOverlaySaved: (saved: boolean) => void,
  setOverlaySaving: (saving: boolean) => void,
) {
  const { push: pushToast, dismissByKey } = useToast();
  const { t } = useI18n();
  return async (pokemonId: string, mode: OverlayMode, overlay: OverlaySettings | null) => {
    const p = appState.pokemon.find((x) => x.id === pokemonId);
    if (!p) return;
    setOverlaySaving(true);
    try {
      const payload = {
        name: p.name,
        nickname: p.nickname,
        title: p.title,
        canonical_name: p.canonical_name,
        sprite_url: p.sprite_url,
        sprite_type: p.sprite_type,
        sprite_style: p.sprite_style,
        language: p.language,
        game: p.game,
        hunt_mode: p.hunt_mode,
        step: p.step,
        overlay_mode: mode,
        overlay,
      };
      const res = await fetch(apiUrl(`/api/pokemon/${p.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("overlay save failed");
      dismissByKey("overlay-save");
      setOverlayDirty(false);
      setOverlaySaved(true);
      setTimeout(() => setOverlaySaved(false), 2000);
    } catch (err) {
      console.error(err);
      pushToast({ type: "error", title: t("overlay.errSaveFailed"), key: "overlay-save" });
    }
    setOverlaySaving(false);
  };
}
