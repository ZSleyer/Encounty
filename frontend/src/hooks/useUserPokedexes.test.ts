import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPokedexes } from "./useUserPokedexes";
import { DEFAULT_POKEDEX } from "../utils/userPokedex";

const custom = { ...DEFAULT_POKEDEX, id: "one", name: "Kanto", form_categories: DEFAULT_POKEDEX.form_categories.slice(0, 1) };

beforeEach(() => localStorage.clear());

describe("useUserPokedexes", () => {
  it("loads, selects, creates, updates, and removes pokedexes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [custom] })
      .mockResolvedValueOnce({ ok: true, json: async () => [custom, { ...custom, id: "two" }] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ ...custom, name: "Updated" }] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => [custom] });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useUserPokedexes());
    await waitFor(() => expect(result.current.active.id).toBe("one"));
    await act(() => result.current.save({ ...custom, id: "" }));
    expect(result.current.active.id).toBe("two");
    await act(() => result.current.save({ ...custom, name: "Updated" }));
    expect(result.current.pokedexes[0].name).toBe("Updated");
    await act(() => result.current.remove("one"));
    expect(localStorage.getItem("encounty.active-pokedex")).toBe("default");
  });

  it("keeps state on invalid loads and rolls back failed writes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useUserPokedexes());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await expect(act(() => result.current.save({ ...custom, id: "" }))).rejects.toThrow("create");
    await expect(act(() => result.current.save(custom))).rejects.toThrow("save");
    expect(result.current.active.id).toBe("default");
  });
});
