import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPokedexCache } from "./pokedexData";
import { markSpeciesSeen } from "./dexSeen";

const species = [
  {
    id: 37,
    canonical: "vulpix",
    gender_rate: 6,
    names: { en: "Vulpix" },
    forms: [{ canonical: "vulpix-alola", sprite_id: 10103 }],
  },
];

beforeEach(() => resetPokedexCache());

describe("markSpeciesSeen", () => {
  it("creates a form override without downgrading caught", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => species })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { species_id: 37, form_canonical: "vulpix-alola", caught: true, seen: false },
        ],
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await markSpeciesSeen("VULPIX-ALOLA");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({
      species_id: 37,
      form_canonical: "vulpix-alola",
      caught: true,
      seen: true,
    });
  });

  it("does nothing for empty, unknown, already seen, or failed data", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => species });
    vi.stubGlobal("fetch", fetch);
    await markSpeciesSeen("");
    await markSpeciesSeen("missing");
    expect(fetch).toHaveBeenCalledTimes(1);

    resetPokedexCache();
    fetch
      .mockReset()
      .mockResolvedValueOnce({ ok: true, json: async () => species })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ species_id: 37, seen: true }] });
    await markSpeciesSeen("vulpix");
    expect(fetch).toHaveBeenCalledTimes(2);

    resetPokedexCache();
    fetch.mockReset().mockRejectedValue(new Error("offline"));
    await expect(markSpeciesSeen("vulpix")).resolves.toBeUndefined();
  });
});
