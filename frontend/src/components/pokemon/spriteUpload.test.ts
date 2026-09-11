/**
 * spriteUpload.test.ts: Guards the shape of the reference a finished sprite
 * upload puts into the form.
 *
 * The reference is persisted and later rendered from two origins that disagree
 * on an absolute form: the Electron renderer reaches the backend over its TLS
 * port, an OBS browser source only over plain HTTP. Baking either one in breaks
 * the other, so the stored value has to stay app-relative. The api module reads
 * the base once at import time, which is why the electronAPI bridge is faked
 * before the module under test is pulled in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const RELATIVE_SPRITE_URL = "/api/pokemon/p1/sprite?v=1700000000";

/**
 * Runs a successful upload with the given API base configured and reports the
 * URL handed to the form.
 */
async function uploadWithApiBase(apiBaseUrl: string): Promise<string> {
  vi.resetModules();
  (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
    isElectron: true,
    apiBaseUrl,
    overlayBaseUrl: "http://localhost:8192",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sprite_url: RELATIVE_SPRITE_URL }),
    }),
  );

  const { handleSpriteFile } = await import("./spriteUpload");
  let stored = "";
  const file = new File(["x"], "sprite.png", { type: "image/png" });
  const event = {
    target: { files: [file], value: "sprite.png" },
  } as unknown as React.ChangeEvent<HTMLInputElement>;

  await handleSpriteFile(event, {
    pokemonId: "p1",
    t: (key: string) => key,
    push: () => undefined,
    setCustomSprite: (url: string) => {
      stored = url;
    },
    setUploading: () => undefined,
  });
  return stored;
}

describe("handleSpriteFile", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps the stored reference relative behind the TLS api base", async () => {
    await expect(uploadWithApiBase("https://127.0.0.1:8193")).resolves.toBe(RELATIVE_SPRITE_URL);
  });

  it("keeps the stored reference relative without an api base", async () => {
    await expect(uploadWithApiBase("")).resolves.toBe(RELATIVE_SPRITE_URL);
  });
});
