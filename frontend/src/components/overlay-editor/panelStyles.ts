/**
 * CSS class strings shared by the controls of the overlay property panel. They
 * stay next to the panel rather than in the global utils because nothing
 * outside the editor renders these two control shapes.
 */

/** Shared CSS for the panel's `<select>` controls. */
export const SELECT_CLASS =
  "w-full bg-bg-primary border border-border-subtle rounded-none px-2.5 py-1.5 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue";

/** Shared class of the single-line text inputs in the property panel. */
export const TEXT_INPUT_CLASS =
  "w-full bg-bg-primary border border-border-subtle rounded-none px-2.5 py-1.5 text-xs text-text-primary";
