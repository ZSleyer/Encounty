/**
 * spriteUpload.ts: Storing and removing a locally chosen sprite image for a
 * Pokemon that already exists server-side.
 *
 * Both operations only make sense in the form's edit mode, where there is an
 * id to upload against, which is why the context carries a nullable id rather
 * than the mode: the caller resolves the mode once and the helpers stay free of
 * the form's discriminated union.
 */
import { apiUrl } from "../../utils/api";

/**
 * Maximum accepted local sprite upload size in bytes. Kept in sync with the
 * backend cap (spriteMaxBytes) so the client can reject oversized files before
 * uploading; the backend remains the authoritative guard.
 */
// Matches imageupload.MaxBytes on the backend, which backgrounds and sprites
// now share. Anything wider than 4K is scaled down there before storage.
export const SPRITE_MAX_BYTES = 30 * 1024 * 1024;

/** Image MIME types accepted for local sprite uploads (matches backend). */
export const SPRITE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** What both sprite operations need from the form that hosts them. */
interface SpriteContext {
  /** Id of the Pokemon being edited, or null in add mode where there is none. */
  readonly pokemonId: string | null;
  readonly t: (key: string, options?: Record<string, string | number>) => string;
  readonly push: (toast: { type: "error" | "success"; title: string }) => void;
  readonly setCustomSprite: (url: string) => void;
}

/** Context of {@link handleSpriteFile}. */
export interface SpriteUploadContext extends SpriteContext {
  readonly setUploading: (value: boolean) => void;
}

/** Context of {@link handleSpriteDelete}. */
export interface SpriteDeleteContext extends SpriteContext {
  readonly setDeleting: (value: boolean) => void;
  /** Auto-computed sprite the form falls back to once the upload is gone. */
  readonly fallbackSprite: string;
}

/**
 * Upload a locally chosen image as the Pokemon's sprite.
 *
 * Only available in edit mode, where the Pokemon already has an id to upload
 * against. The bytes are stored server-side (DB binary) and served over HTTP;
 * we keep only the returned reference URL in the form. The URL is resolved
 * through apiUrl so it points at the backend (fixed port) from the Electron
 * renderer and the OBS overlay alike, rather than the renderer origin.
 */
export async function handleSpriteFile(
  e: React.ChangeEvent<HTMLInputElement>,
  ctx: SpriteUploadContext,
) {
  const { pokemonId, t, push, setCustomSprite, setUploading } = ctx;
  const file = e.target.files?.[0];
  e.target.value = ""; // allow re-picking the same file later
  if (!file || pokemonId === null) return;

  if (!SPRITE_ACCEPT.split(",").includes(file.type)) {
    push({ type: "error", title: t("modal.spriteUpload.invalidType") });
    return;
  }
  if (file.size > SPRITE_MAX_BYTES) {
    push({ type: "error", title: t("modal.spriteUpload.tooLarge") });
    return;
  }

  setUploading(true);
  try {
    const res = await fetch(apiUrl(`/api/pokemon/${pokemonId}/sprite`), {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      const title =
        res.status === 413 ? t("modal.spriteUpload.tooLarge") : t("modal.spriteUpload.failed");
      push({ type: "error", title });
      return;
    }
    const body: { sprite_url: string } = await res.json();
    setCustomSprite(apiUrl(body.sprite_url));
    push({ type: "success", title: t("modal.spriteUpload.success") });
  } catch {
    push({ type: "error", title: t("modal.spriteUpload.failed") });
  } finally {
    setUploading(false);
  }
}

/**
 * Removes the currently uploaded custom sprite for this Pokemon, both
 * server-side (DELETE the stored BLOB) and in the form state, falling back
 * to the auto-computed default sprite (selected.sprite) instead of leaving
 * the field blank, and persisting that fallback immediately so other views
 * (list, overlay) don't show a broken/placeholder image before the next
 * Save. Only available in edit mode, mirroring handleSpriteFile's guard.
 */
export async function handleSpriteDelete(ctx: SpriteDeleteContext) {
  const { pokemonId, t, push, setCustomSprite, setDeleting, fallbackSprite } = ctx;
  if (pokemonId === null) return;
  setDeleting(true);
  try {
    const res = await fetch(apiUrl(`/api/pokemon/${pokemonId}/sprite`), {
      method: "DELETE",
    });
    if (!res.ok) {
      push({ type: "error", title: t("modal.spriteUpload.removeFailed") });
      return;
    }
    setCustomSprite(fallbackSprite);
    if (fallbackSprite) {
      await fetch(apiUrl(`/api/pokemon/${pokemonId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprite_url: fallbackSprite }),
      });
    }
    push({ type: "success", title: t("modal.spriteUpload.removed") });
  } catch {
    push({ type: "error", title: t("modal.spriteUpload.removeFailed") });
  } finally {
    setDeleting(false);
  }
}
