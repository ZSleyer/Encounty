/**
 * accents.ts: Compatibility mapping for accent color settings.
 *
 * Keeps the pre-Tempest palette readable by the current theme layer so a
 * restored backup never lands on an accent key that index.css cannot match.
 */
import { AccentColor } from "../types";

// Maps accent keys from the pre-Tempest palette to their closest Tempest
// preset so settings restored from old backups still resolve to a valid value.
export const LEGACY_ACCENTS: Record<string, AccentColor> = {
  purple: "violet",
};
