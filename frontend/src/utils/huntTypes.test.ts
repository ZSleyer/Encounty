import { describe, it, expect } from "vitest";
import { HUNT_METHODS, getAvailableHuntMethods } from "./huntTypes";

describe("HUNT_METHODS", () => {
  it("has 18 entries", () => {
    expect(HUNT_METHODS).toHaveLength(18);
  });

  it("every method has minGen >= 1", () => {
    for (const m of HUNT_METHODS) {
      expect(m.minGen).toBeGreaterThanOrEqual(1);
    }
  });

  it("every method has maxGen null or >= minGen", () => {
    for (const m of HUNT_METHODS) {
      if (m.maxGen !== null) {
        expect(m.maxGen).toBeGreaterThanOrEqual(m.minGen);
      }
    }
  });
});

describe("getAvailableHuntMethods", () => {
  it("returns all methods when generation is null", () => {
    expect(getAvailableHuntMethods(null)).toEqual(HUNT_METHODS);
  });

  it("returns all methods when generation is undefined", () => {
    expect(getAvailableHuntMethods(undefined)).toEqual(HUNT_METHODS);
  });

  it("gen 1 includes encounter but excludes masuda", () => {
    const keys = getAvailableHuntMethods(1).map((m) => m.key);
    expect(keys).toContain("encounter");
    expect(keys).not.toContain("masuda");
  });

  it("gen 4 includes masuda and radar", () => {
    const keys = getAvailableHuntMethods(4).map((m) => m.key);
    expect(keys).toContain("masuda");
    expect(keys).toContain("radar");
  });

  it("gen 6 includes horde, chain_fishing, dexnav, friend_safari", () => {
    const keys = getAvailableHuntMethods(6).map((m) => m.key);
    expect(keys).toContain("horde");
    expect(keys).toContain("chain_fishing");
    expect(keys).toContain("dexnav");
    expect(keys).toContain("friend_safari");
  });

  it("gen 7 includes sos but excludes horde", () => {
    const keys = getAvailableHuntMethods(7).map((m) => m.key);
    expect(keys).toContain("sos");
    expect(keys).not.toContain("horde");
  });

  it("gen 9 includes sandwich and tera_raid", () => {
    const keys = getAvailableHuntMethods(9).map((m) => m.key);
    expect(keys).toContain("sandwich");
    expect(keys).toContain("tera_raid");
  });
});
