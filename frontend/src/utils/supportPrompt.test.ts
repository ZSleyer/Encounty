/**
 * supportPrompt.test.ts — verifies the interval semantics of the support-nudge
 * threshold rule: stage 1 fires once at 500, stage 2 fires exactly once per
 * 20,000 boundary, and skipping past a boundary still fires exactly once.
 */
import { describe, it, expect } from "vitest";
import { nextPrompt, STAR_THRESHOLD, RECOMMEND_STEP } from "./supportPrompt";

describe("nextPrompt — stage 1 (star)", () => {
  it("does not fire below the threshold", () => {
    expect(nextPrompt(STAR_THRESHOLD - 1, false, 0).pending).toBeNull();
  });

  it("fires at the threshold", () => {
    expect(nextPrompt(STAR_THRESHOLD, false, 0).pending).toBe("star");
  });

  it("keeps arming star while stage 1 is unhandled (shown once by the pending flag)", () => {
    expect(nextPrompt(1234, false, 0).pending).toBe("star");
  });
});

describe("nextPrompt — stage 2 (recommend)", () => {
  it("fires exactly once at the first boundary", () => {
    const r = nextPrompt(RECOMMEND_STEP, true, 0);
    expect(r.pending).toBe("recommend");
    expect(r.recommendBlock).toBe(1);
  });

  it("does not fire again while sitting above the same boundary", () => {
    expect(nextPrompt(RECOMMEND_STEP + 1, true, 1).pending).toBeNull();
    expect(nextPrompt(25000, true, 1).pending).toBeNull();
    expect(nextPrompt(39999, true, 1).pending).toBeNull();
  });

  it("fires again at the next boundary", () => {
    const r = nextPrompt(2 * RECOMMEND_STEP, true, 1);
    expect(r.pending).toBe("recommend");
    expect(r.recommendBlock).toBe(2);
  });

  it("fires exactly once when a start skips past a boundary (15000 -> 41000)", () => {
    // recommendBlock was 0 (last fired at total 15000, block 0); jump to 41000.
    const r = nextPrompt(41000, true, 0);
    expect(r.pending).toBe("recommend");
    expect(r.recommendBlock).toBe(2); // advances straight to block 2, no double fire
  });

  it("does not fire when the block was already recorded (settings-toggle init)", () => {
    // Toggling "already support" at 45000 initializes block to floor(45000/20000)=2.
    expect(nextPrompt(45000, true, 2).pending).toBeNull();
  });
});
