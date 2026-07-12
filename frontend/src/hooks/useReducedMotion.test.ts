import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { useReducedMotion } from "./useReducedMotion";
import { ThemeProvider } from "../contexts/ThemeContext";

/** Installs a matchMedia stub and returns a trigger to simulate query changes. */
function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    fire(next: boolean) {
      mql.matches = next;
      for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent);
    },
  };
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return createElement(ThemeProvider, null, children);
}

describe("useReducedMotion", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("returns false by default (no OS preference, motion auto)", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion(), { wrapper });
    expect(result.current).toBe(false);
  });

  it("returns false when matchMedia is unavailable and motion is auto", () => {
    // jsdom has no matchMedia by default; the hook must tolerate that.
    const { result } = renderHook(() => useReducedMotion(), { wrapper });
    expect(result.current).toBe(false);
  });

  it("returns true when the stored motion preference is off", () => {
    mockMatchMedia(false);
    localStorage.setItem("encounty-motion", "off");
    const { result } = renderHook(() => useReducedMotion(), { wrapper });
    expect(result.current).toBe(true);
  });

  it("returns true when prefers-reduced-motion matches", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion(), { wrapper });
    expect(result.current).toBe(true);
  });

  it("reacts to media query changes", () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion(), { wrapper });
    expect(result.current).toBe(false);

    act(() => media.fire(true));
    expect(result.current).toBe(true);

    act(() => media.fire(false));
    expect(result.current).toBe(false);
  });
});
