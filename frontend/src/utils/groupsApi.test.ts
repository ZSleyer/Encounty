import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  startGroupHunt,
  stopGroupHunt,
} from "./groupsApi";

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

  describe("listGroups", () => {
    it("returns the groups array from the response", async () => {
      const groups = [{ id: "g1", name: "A", color: "", sort_order: 0, collapsed: false }];
      stubFetch(200, { groups });
      await expect(listGroups()).resolves.toEqual(groups);
    });

    it("falls back to an empty array when the response omits groups", async () => {
      stubFetch(200, {});
      await expect(listGroups()).resolves.toEqual([]);
    });

    it("throws on non-OK status", async () => {
      stubFetch(500);
      await expect(listGroups()).rejects.toThrow(/500/);
    });
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
      const fetchMock = stubFetch(201, { id: "g1", name: "x", color: "", sort_order: 0, collapsed: false });
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

  describe("startGroupHunt / stopGroupHunt", () => {
    it("start returns the members array", async () => {
      const members = [{ id: "p1", started: true }];
      stubFetch(200, { members });
      await expect(startGroupHunt("g1")).resolves.toEqual(members);
    });

    it("start falls back to empty array", async () => {
      stubFetch(200, {});
      await expect(startGroupHunt("g1")).resolves.toEqual([]);
    });

    it("start throws on non-OK", async () => {
      stubFetch(400);
      await expect(startGroupHunt("g1")).rejects.toThrow(/startGroupHunt/);
    });

    it("stop returns the members array", async () => {
      const members = [{ id: "p1", stopped: true }];
      stubFetch(200, { members });
      await expect(stopGroupHunt("g1")).resolves.toEqual(members);
    });

    it("stop falls back to empty array", async () => {
      stubFetch(200, {});
      await expect(stopGroupHunt("g1")).resolves.toEqual([]);
    });

    it("stop throws on non-OK", async () => {
      stubFetch(400);
      await expect(stopGroupHunt("g1")).rejects.toThrow(/stopGroupHunt/);
    });
  });
});
