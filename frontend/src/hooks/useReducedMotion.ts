/**
 * useReducedMotion.ts: hook that reports whether motion should be reduced.
 *
 * Combines the OS-level `prefers-reduced-motion: reduce` media query with the
 * in-app motion preference stored in ThemeContext ("encounty-motion"). Either
 * source alone is enough to reduce motion.
 */
import { useEffect, useState } from "react";
import { useMotion } from "../contexts/ThemeContext";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Reads the current media query state, tolerating environments without matchMedia. */
function systemPrefersReducedMotion(): boolean {
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

/**
 * useReducedMotion returns true when the OS requests reduced motion or the
 * in-app motion preference is set to "off". Subscribes to media query changes
 * so OS-level toggles take effect without a reload.
 */
export function useReducedMotion(): boolean {
  const { motion } = useMotion();
  const [systemReduced, setSystemReduced] = useState(systemPrefersReducedMotion);

  useEffect(() => {
    const mql = globalThis.matchMedia?.(QUERY);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent) => setSystemReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return systemReduced || motion === "off";
}
