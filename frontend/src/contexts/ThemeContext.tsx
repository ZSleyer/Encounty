/**
 * ThemeContext.tsx: dark/light theme and motion preference context.
 *
 * The chosen theme is persisted to localStorage under "encounty-theme" and
 * applied as a `data-theme` attribute on `<html>` for CSS variable switching.
 * Defaults to "dark" if no preference is stored.
 *
 * The motion preference is persisted under "encounty-motion" ("auto" | "off",
 * default "auto"). Unlike the theme, the provider does NOT write any DOM
 * attribute for it: AppShell owns the `data-motion` attribute so the /overlay
 * OBS view is exempt from motion gating by construction.
 *
 * The duration format is persisted under "encounty-duration-format" and decides
 * whether the aggregate hunt times spell whole days out. It lives here rather
 * than in the backend settings because it is a per-device display choice, and
 * because the overlay and the file output deliberately keep their fixed format.
 */
import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import type { DurationFormat } from "../utils/timer";

type Theme = "dark" | "light";

/** MotionPreference selects between system-driven ("auto") and forced-off motion. */
export type MotionPreference = "auto" | "off";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  motion: MotionPreference;
  setMotion: (m: MotionPreference) => void;
  durationFormat: DurationFormat;
  setDurationFormat: (f: DurationFormat) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  motion: "auto",
  setMotion: () => {},
  durationFormat: "hms",
  setDurationFormat: () => {},
});

/** ThemeProvider wraps the app with theme and motion state plus their setters. */
export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("encounty-theme");
    return (saved === "light" ? "light" : "dark") as Theme;
  });

  const [motion, setMotion] = useState<MotionPreference>(() => {
    const saved = localStorage.getItem("encounty-motion");
    return saved === "off" ? "off" : "auto";
  });

  const [durationFormat, setDurationFormat] = useState<DurationFormat>(() => {
    const saved = localStorage.getItem("encounty-duration-format");
    return saved === "dhms" ? "dhms" : "hms";
  });

  useEffect(() => {
    localStorage.setItem("encounty-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Persist only. The `data-motion` DOM attribute is managed by AppShell so
  // that overlay routes (OBS browser source) never get motion-gated.
  useEffect(() => {
    localStorage.setItem("encounty-motion", motion);
  }, [motion]);

  useEffect(() => {
    localStorage.setItem("encounty-duration-format", durationFormat);
  }, [durationFormat]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme, motion, setMotion, durationFormat, setDurationFormat }),
    [theme, motion, durationFormat],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** useTheme returns the current theme and helpers to toggle or set it. */
export function useTheme() {
  return useContext(ThemeContext);
}

/** useDurationFormat returns the stored duration format and its setter. */
export function useDurationFormat(): {
  durationFormat: DurationFormat;
  setDurationFormat: (f: DurationFormat) => void;
} {
  const { durationFormat, setDurationFormat } = useContext(ThemeContext);
  return { durationFormat, setDurationFormat };
}

/** useMotion returns the stored motion preference and its setter. */
export function useMotion(): {
  motion: MotionPreference;
  setMotion: (m: MotionPreference) => void;
} {
  const { motion, setMotion } = useContext(ThemeContext);
  return { motion, setMotion };
}
