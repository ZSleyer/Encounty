import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGroup, updateGroup, deleteGroup } from "./groupsApi";

/** Builds a fetch stub that resolves with the given status and JSON body. */
function stubFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("groupsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("createGroup", () => {
    it("POSTs the name and color and returns the created group", async () => {
      const group = { id: "g9", name: "New", color: "#fff", sort_order: 0, collapsed: false };
      const fetchMock = stubFetch(201, group);
      const result = await createGroup("New", "#fff");
      expect(result).toEqual(group);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ name: "New", color: "#fff" }));
    });

    it("omits color when not provided", async () => {
      const fetchMock = stubFetch(201, {
        id: "g1",
        name: "x",
        color: "",
        sort_order: 0,
        collapsed: false,
      });
      await createGroup("x");
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.body).toBe(JSON.stringify({ name: "x" }));
    });

    it("throws on non-OK status", async () => {
      stubFetch(400);
      await expect(createGroup("bad")).rejects.toThrow(/400/);
    });
  });

  describe("updateGroup", () => {
    it("PUTs the patch and returns the updated group", async () => {
      const group = { id: "g1", name: "Updated", color: "#000", sort_order: 2, collapsed: true };
      const fetchMock = stubFetch(200, group);
      const result = await updateGroup("g1", { name: "Updated", sort_order: 2 });
      expect(result).toEqual(group);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/groups/g1");
      expect(init.method).toBe("PUT");
    });

    it("throws on non-OK status", async () => {
      stubFetch(404);
      await expect(updateGroup("gone", { name: "x" })).rejects.toThrow(/404/);
    });
  });

  describe("deleteGroup", () => {
    it("resolves on 204", async () => {
      stubFetch(204);
      await expect(deleteGroup("g1")).resolves.toBeUndefined();
    });

    it("resolves on 200", async () => {
      stubFetch(200);
      await expect(deleteGroup("g1")).resolves.toBeUndefined();
    });

    it("throws on other non-OK statuses", async () => {
      stubFetch(500);
      await expect(deleteGroup("g1")).rejects.toThrow(/500/);
    });
  });
});
