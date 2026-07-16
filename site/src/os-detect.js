// Shared OS detection used across the marketing site (landing + update pages).

/**
 * Detects the visitor's desktop operating system from the user agent.
 * Returns "windows", "macos", "linux", or null when detection is
 * inconclusive (mobile OSes and unknown platforms fall through to null).
 * @returns {"windows"|"macos"|"linux"|null}
 */
export function detectOS() {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad|iPod/.test(ua)) return "macos";
  if (/Linux/.test(ua) && !/Android/.test(ua)) return "linux";
  return null;
}
