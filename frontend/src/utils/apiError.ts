/**
 * apiError.ts: Mapping of structured backend error responses to localized text.
 *
 * The backend returns machine-readable error codes alongside a raw English
 * message. This module turns a known code into a translated, user-facing
 * string and falls back to the server message for everything else.
 */

/** Structured error body returned by the backend on a failed request. */
export interface ApiError {
  error?: string;
  code?: string;
  details?: { roots?: string[] };
}

/**
 * Turn a structured backend error into a localized message. Known error codes
 * are mapped to a translated string, while unknown codes fall back to the raw
 * server-provided message.
 */
export function localizeApiError(
  data: ApiError,
  t: (key: string, options?: Record<string, string | number>) => string,
): string {
  if (data.code === "path_outside_allowed_roots") {
    return t("settings.pathOutsideRoots", { roots: (data.details?.roots ?? []).join(", ") });
  }
  return data.error ?? "";
}
