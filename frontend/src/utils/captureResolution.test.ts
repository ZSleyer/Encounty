import { describe, it, expect } from "vitest";
import { resolutionConstraints, effectiveResolution } from "./captureResolution";

describe("resolutionConstraints", () => {
  it("maps 1080 to ideal 1920x1080", () => {
    expect(resolutionConstraints("1080")).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
  });

  it("maps 720 to ideal 1280x720", () => {
    expect(resolutionConstraints("720")).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
  });

  it("maps 1440 to ideal 2560x1440", () => {
    expect(resolutionConstraints("1440")).toEqual({
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    });
  });

  it("returns an empty object for auto (no constraint)", () => {
    expect(resolutionConstraints("auto")).toEqual({});
  });
});

describe("effectiveResolution", () => {
  it("returns the stored resolution for a known device", () => {
    expect(effectiveResolution({ "cam-1": "720" }, "cam-1")).toBe("720");
  });

  it("defaults to 1080 for an unknown device", () => {
    expect(effectiveResolution({ "cam-1": "720" }, "cam-2")).toBe("1080");
  });

  it("defaults to 1080 when the map is undefined", () => {
    expect(effectiveResolution(undefined, "cam-1")).toBe("1080");
  });
});
