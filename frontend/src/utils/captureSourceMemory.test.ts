import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getLastSource,
  getGlobalLastSource,
  saveLastSource,
} from "./captureSourceMemory";

const POKEMON_ID = "poke-42";
const PER_POKEMON_KEY = `encounty.lastCaptureSource.${POKEMON_ID}`;
const GLOBAL_KEY = "encounty.lastCaptureSource.global";

describe("captureSourceMemory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a saved source via per-pokemon and global lookups", () => {
    saveLastSource(POKEMON_ID, {
      type: "browser_display",
      sourceId: "screen:0",
      sourceLabel: "Display 1",
      displayId: "0",
    });

    const perPokemon = getLastSource(POKEMON_ID);
    expect(perPokemon).not.toBeNull();
    expect(perPokemon?.type).toBe("browser_display");
    expect(perPokemon?.sourceId).toBe("screen:0");
    expect(perPokemon?.sourceLabel).toBe("Display 1");
    expect(perPokemon?.displayId).toBe("0");
    expect(typeof perPokemon?.persistedAt).toBe("string");

    const globalEntry = getGlobalLastSource();
    expect(globalEntry).not.toBeNull();
    expect(globalEntry?.sourceId).toBe("screen:0");
  });

  it("round-trips a camera source without displayId", () => {
    saveLastSource(POKEMON_ID, {
      type: "browser_camera",
      sourceId: "cam-device-123",
      sourceLabel: "Logitech C920",
    });

    const entry = getLastSource(POKEMON_ID);
    expect(entry?.type).toBe("browser_camera");
    expect(entry?.sourceId).toBe("cam-device-123");
    expect(entry?.sourceLabel).toBe("Logitech C920");
    expect(entry?.displayId).toBeUndefined();
  });

  it("returns null for a missing per-pokemon key", () => {
    expect(getLastSource("unknown-pokemon")).toBeNull();
  });

  it("returns null for a missing global key", () => {
    expect(getGlobalLastSource()).toBeNull();
  });

  it("returns null when the stored JSON is corrupted", () => {
    localStorage.setItem(PER_POKEMON_KEY, "{ this is not valid json");
    localStorage.setItem(GLOBAL_KEY, "also broken");

    expect(getLastSource(POKEMON_ID)).toBeNull();
    expect(getGlobalLastSource()).toBeNull();
  });

  it("returns null when the stored payload is missing required fields", () => {
    localStorage.setItem(PER_POKEMON_KEY, JSON.stringify({ type: "browser_display" }));
    expect(getLastSource(POKEMON_ID)).toBeNull();
  });

  it("returns null when the stored type is invalid", () => {
    localStorage.setItem(
      PER_POKEMON_KEY,
      JSON.stringify({
        type: "mystery_source",
        sourceId: "x",
        sourceLabel: "y",
        persistedAt: "2024-01-01T00:00:00Z",
      }),
    );
    expect(getLastSource(POKEMON_ID)).toBeNull();
  });

  it("does not throw when localStorage.setItem raises (e.g. quota exceeded)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() =>
      saveLastSource(POKEMON_ID, {
        type: "browser_display",
        sourceId: "screen:0",
        sourceLabel: "Display 1",
      }),
    ).not.toThrow();

    expect(spy).toHaveBeenCalled();
  });

  it("does not throw when localStorage.getItem raises", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => getLastSource(POKEMON_ID)).not.toThrow();
    expect(getLastSource(POKEMON_ID)).toBeNull();
    expect(getGlobalLastSource()).toBeNull();
  });

  it("getLastSource returns null for empty pokemonId without reading storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem");
    expect(getLastSource("")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("saveLastSource still writes global key even when pokemonId is empty", () => {
    saveLastSource("", {
      type: "browser_camera",
      sourceId: "cam-0",
      sourceLabel: "Front Camera",
    });
    expect(getGlobalLastSource()?.sourceId).toBe("cam-0");
  });

  it("persistedAt is overwritten on each save", async () => {
    saveLastSource(POKEMON_ID, {
      type: "browser_display",
      sourceId: "screen:0",
      sourceLabel: "Display 1",
    });
    const first = getLastSource(POKEMON_ID)!.persistedAt;

    // Wait enough for Date.now() to advance (1 ms is enough — toISOString has
    // millisecond resolution). Using a microtask await isn't sufficient.
    await new Promise((r) => setTimeout(r, 5));

    saveLastSource(POKEMON_ID, {
      type: "browser_display",
      sourceId: "screen:1",
      sourceLabel: "Display 2",
    });
    const second = getLastSource(POKEMON_ID)!.persistedAt;

    expect(second >= first).toBe(true);
    expect(getLastSource(POKEMON_ID)?.sourceId).toBe("screen:1");
  });
});
