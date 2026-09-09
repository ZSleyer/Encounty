import { describe, it, expect, vi, afterEach } from "vitest";
import { formatTimer, formatDuration, computeTimerMs } from "./timer";
import { makePokemon } from "../test-utils";

describe("formatTimer", () => {
  it("pads every segment to two digits", () => {
    expect(formatTimer(0)).toBe("00:00:00");
  });

  it("renders hours, minutes and seconds", () => {
    expect(formatTimer(3_661_000)).toBe("01:01:01");
  });

  it("lets the hours run past a day", () => {
    expect(formatTimer(443_045_000)).toBe("123:04:05");
  });
});

describe("formatDuration", () => {
  it("keeps unbounded hours in hms", () => {
    expect(formatDuration(91_210_000, "hms")).toBe("25:20:10");
  });

  it("splits whole days off in dhms", () => {
    expect(formatDuration(91_210_000, "dhms")).toBe("1:01:20:10");
  });

  it("omits the day part below 24 hours", () => {
    expect(formatDuration(3_661_000, "dhms")).toBe("01:01:01");
  });

  it("writes the day count without a leading zero", () => {
    expect(formatDuration(9 * 86_400_000, "dhms")).toBe("9:00:00:00");
  });

  it("clamps negative and non-finite input to zero", () => {
    expect(formatDuration(-5000, "dhms")).toBe("00:00:00");
    expect(formatDuration(Number.NaN, "hms")).toBe("00:00:00");
  });
});

describe("computeTimerMs", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the accumulated value while the timer is stopped", () => {
    expect(computeTimerMs(makePokemon({ timer_accumulated_ms: 5000 }))).toBe(5000);
  });

  it("treats a missing accumulator as zero", () => {
    expect(computeTimerMs(makePokemon())).toBe(0);
  });

  it("adds the running segment to the accumulated value", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    const pokemon = makePokemon({
      timer_accumulated_ms: 1000,
      timer_started_at: "2024-01-01T00:00:00Z",
    });
    expect(computeTimerMs(pokemon)).toBe(31_000);
  });
});
