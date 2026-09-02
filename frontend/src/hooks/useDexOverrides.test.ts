import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDexOverrides } from "./useDexOverrides";

/** Fetch mock: GET returns an empty override list, PUT echoes a minimal row. */
function mockFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (!init) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    const body = JSON.parse(String(init.body));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 1,
          species_id: body.species_id,
          form_canonical: body.form_canonical,
          gender: body.gender,
          game: body.game,
          caught: body.caught,
          seen: body.seen,
          updated_at: "2026-01-01T00:00:00Z",
          ...("meta" in body ? { meta: body.meta } : {}),
        }),
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

describe("useDexOverrides", () => {
  it("omits the meta key entirely from a plain caught/seen write", async () => {
    const { result } = renderHook(() => useDexOverrides());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setOverride({
        speciesId: 906,
        formCanonical: "",
        gender: "",
        game: "",
        caught: true,
        seen: true,
      });
    });

    const putCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    const sentBody = JSON.parse(String(putCall?.[1]?.body));
    // The backend contract: an absent key preserves whatever meta is already
    // stored server-side, while a present-but-undefined value would still be
    // dropped by JSON.stringify, so this asserts the key itself, not just its
    // value.
    expect("meta" in sentBody).toBe(false);
  });

  it("includes the meta key verbatim when a caller actually has one to write", async () => {
    const { result } = renderHook(() => useDexOverrides());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setOverride({
        speciesId: 906,
        formCanonical: "",
        gender: "",
        game: "",
        caught: true,
        seen: true,
        meta: { location: "Route 1", level: 5 },
      });
    });

    const putCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    const sentBody = JSON.parse(String(putCall?.[1]?.body));
    expect(sentBody.meta).toEqual({ location: "Route 1", level: 5 });
  });

  it("stores the meta from the response on the local override list", async () => {
    const { result } = renderHook(() => useDexOverrides());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setOverride({
        speciesId: 906,
        formCanonical: "",
        gender: "",
        game: "",
        caught: true,
        seen: true,
        meta: { level: 12 },
      });
    });

    expect(result.current.overrides).toEqual([
      expect.objectContaining({ speciesId: 906, meta: { level: 12 } }),
    ]);
  });

  it("sends the existing id when moving an override scope", async () => {
    const { result } = renderHook(() => useDexOverrides());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setOverride({
        id: 7,
        speciesId: 906,
        formCanonical: "",
        gender: "female",
        game: "",
        caught: true,
        seen: true,
      });
    });

    const putCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(putCall?.[1]?.body)).id).toBe(7);
  });
});
