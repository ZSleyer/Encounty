/**
 * clipboard.ts: the shared copy-to-clipboard gesture used by every "copy this
 * URL/path" button in the app.
 *
 * Every one of those buttons flips a short-lived "copied" flag that swaps the
 * icon and the label. Only the surrounding feedback differs (some raise a
 * toast on failure, some stay silent), so that part is left to the caller.
 */

/** How long the "copied" flag stays raised, in milliseconds. */
export const COPIED_FLAG_MS = 2000;

/** Optional side effects a call site can attach to the copy attempt. */
export interface CopyWithFlagOptions {
  /** Runs before the flag is raised, for example to dismiss a stale toast. */
  readonly onSuccess?: () => void;
  /** Runs when the clipboard write is rejected, for example to raise a toast. */
  readonly onError?: () => void;
}

/**
 * copyWithFlag writes `text` to the clipboard and raises `setCopied` for
 * {@link COPIED_FLAG_MS}, then lowers it again.
 *
 * The timer is deliberately not canceled on unmount: React ignores a state
 * update on an unmounted component, and cancelling it would need a ref at
 * every call site for no user-visible gain.
 */
export function copyWithFlag(
  text: string,
  setCopied: (copied: boolean) => void,
  options: CopyWithFlagOptions = {},
): void {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      options.onSuccess?.();
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FLAG_MS);
    })
    .catch(() => options.onError?.());
}
