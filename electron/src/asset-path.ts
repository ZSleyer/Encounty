// asset-path.ts resolves encounty:// request paths to files on disk.
//
// Kept free of electron imports so it can be exercised with plain Node.

import path from "node:path";

/**
 * Resolves an encounty:// URL pathname to an absolute file path below root.
 * Returns null when the request escapes root, which callers must answer with a
 * refusal rather than a file.
 *
 * The URL parser already collapses literal ../ segments, but it leaves
 * percent-encoded slashes intact: "%2e%2e%2f%2e%2e%2fetc/passwd" survives as a
 * single segment and only becomes "../../etc/passwd" once decoded. Neither
 * path.join nor path.resolve enforces a containment boundary, so the boundary
 * is checked explicitly here.
 */
export function resolveAssetPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding, e.g. "%zz".
    return null;
  }

  // A NUL byte truncates the path for some syscalls.
  if (decoded.includes("\0")) return null;

  const resolvedRoot = path.resolve(root);
  const fullPath = path.resolve(resolvedRoot, decoded.replace(/^\/+/, ""));
  if (fullPath !== resolvedRoot && !fullPath.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return fullPath;
}
