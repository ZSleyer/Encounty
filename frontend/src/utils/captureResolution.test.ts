import { describe, it, expect } from "vitest";
import { resolutionConstraints } from "./captureResolution";

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

  it("returns an empty object for auto (no constraint)", () => {
    expect(resolutionConstraints("auto")).toEqual({});
  });
});
