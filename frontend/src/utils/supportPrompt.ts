/**
 * supportPrompt.ts — silent, genuine-only tracking for the "Support Encounty"
 * nudge.
 *
 * A lifetime encounter counter is incremented once per GENUINE encounter
 * (hotkey / detector, via the `encounter_added` WebSocket event) and never from
 * manual "set encounters" edits. Two deferred prompts derive from it:
 *   - Stage 1: a one-time GitHub star prompt at STAR_THRESHOLD encounters.
 *   - Stage 2: a subtle "recommend" nudge once per RECOMMEND_STEP thereafter.
 * Prompts are only ever set as a pending flag here; they are shown at the next
 * app start (see SupportPrompt / AppShell), never mid-hunt.
 */

/** Encounter count at which the one-time GitHub star prompt arms. */
export const STAR_THRESHOLD = 500;
/** Interval (in encounters) between recurring recommend nudges after stage 1. */
export const RECOMMEND_STEP = 20000;
/** Canonical repository URL used for the star link and share text. */
export const REPO_URL = "https://github.com/ZSleyer/Encounty";

const K_TOTAL = "encounty_total_encounters";
const K_STAR_DONE = "encounty_star_prompt_done";
const K_REC_BLOCK = "encounty_recommend_block";
const K_PENDING = "encounty_prompt_pending";

/** Which support prompt variant is pending / being shown. */
export type PromptVariant = "star" | "recommend";

/**
 * nextPrompt is the pure threshold rule. Given the new lifetime total and the
 * current stage state, it decides which prompt (if any) should arm and the
 * possibly-advanced recommend block. Kept pure so the interval semantics are
 * unit-testable without touching localStorage.
 */
export function nextPrompt(
  total: number,
  starDone: boolean,
  recommendBlock: number,
): { pending: PromptVariant | null; recommendBlock: number } {
  if (!starDone) {
    return { pending: total >= STAR_THRESHOLD ? "star" : null, recommendBlock };
  }
  // Stage 2: fire exactly once per crossed RECOMMEND_STEP boundary. Comparing
  // the block index (not `total % STEP === 0`) means a start that skips past a
  // boundary still nudges exactly once for that block, never twice.
  const block = Math.floor(total / RECOMMEND_STEP);
  if (block > recommendBlock) return { pending: "recommend", recommendBlock: block };
  return { pending: null, recommendBlock };
}

function num(key: string): number {
  return Number.parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
}

/**
 * recordEncounter increments the lifetime counter for one genuine encounter and
 * arms a pending prompt if a threshold was crossed. Call once per
 * `encounter_added` event only.
 */
export function recordEncounter(): void {
  const total = num(K_TOTAL) + 1;
  localStorage.setItem(K_TOTAL, String(total));

  const starDone = localStorage.getItem(K_STAR_DONE) === "1";
  const block = num(K_REC_BLOCK);
  const result = nextPrompt(total, starDone, block);

  if (result.recommendBlock !== block) {
    localStorage.setItem(K_REC_BLOCK, String(result.recommendBlock));
  }
  if (result.pending) {
    localStorage.setItem(K_PENDING, result.pending);
  }
}

/** takePendingPrompt returns the pending prompt variant, or null if none. */
export function takePendingPrompt(): PromptVariant | null {
  const v = localStorage.getItem(K_PENDING);
  return v === "star" || v === "recommend" ? v : null;
}

/** clearPendingPrompt drops the pending flag once the prompt has been shown. */
export function clearPendingPrompt(): void {
  localStorage.removeItem(K_PENDING);
}

/** isStarDone reports whether the user has handled the one-time star prompt. */
export function isStarDone(): boolean {
  return localStorage.getItem(K_STAR_DONE) === "1";
}

/**
 * markStarDone records that stage 1 is handled (star clicked or "already did")
 * and initializes the recommend block to the current total so stage 2 does not
 * fire immediately at whatever the count happens to be.
 */
export function markStarDone(): void {
  localStorage.setItem(K_STAR_DONE, "1");
  localStorage.setItem(K_REC_BLOCK, String(Math.floor(num(K_TOTAL) / RECOMMEND_STEP)));
}

/**
 * shareEncounty invites others to Encounty via the native share sheet when
 * available, else copies an invite line to the clipboard. Returns what happened
 * so callers can confirm a copy. A cancelled/failed share resolves to "failed"
 * without falling through to the clipboard.
 */
export async function shareEncounty(text: string): Promise<"shared" | "copied" | "failed"> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Encounty", text, url: REPO_URL });
      return "shared";
    } catch {
      return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${REPO_URL}`);
    return "copied";
  } catch {
    return "failed";
  }
}
