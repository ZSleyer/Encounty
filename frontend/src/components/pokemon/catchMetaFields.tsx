/**
 * catchMetaFields.tsx: The two generic form controls the catch metadata dialog
 * is built from, a free-text combo box and a dropdown over a reference
 * catalog, plus the input skin they share with the plain fields.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { refLabel, refLabelFor, type CatchRefEntry } from "../../hooks/useCatchRefs";
import { IconSlot } from "./IconSlot";

/** Shared input skin, mirroring the form fields of PokemonFormModal. */
export const INPUT_CLASS =
  "w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary placeholder-text-faint focus:border-accent-blue/50 transition-colors";

// --- Combo field ---

interface ComboFieldProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  /** Suggestions to offer; the caller filters and caps them. */
  readonly options: readonly CatchRefEntry[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly locale: string;
  /** Focus on mount; also marks the field for useModalDialog. */
  readonly autoFocus?: boolean;
  /** Extra classes for the wrapping cell, e.g. a grid span. */
  readonly className?: string;
}

/**
 * Free-text field with a Tempest suggestion list over a reference catalog.
 *
 * Replaces `<datalist>`, whose popup the browser draws in its own chrome and
 * which no stylesheet can reach. The list is built from the same primitives as
 * the species picker: focusable rows instead of `role="option"`, so every entry
 * is reachable with the Tab key (WCAG 2.1.1), and a fixed, anchor-positioned
 * box so the scrollable modal body cannot clip it.
 *
 * Typing stays free-form. The catalog only suggests, so a location a game
 * table does not carry can still be recorded.
 */
export function ComboField({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
  locale,
  autoFocus,
  className,
}: ComboFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const instanceId = useId();
  // useId() yields colons, which are not valid in a CSS dashed-ident.
  const anchorName = `--combo-${instanceId.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const [open, setOpen] = useState(false);

  const suggestions = open ? options : [];

  /** Closes the list once focus leaves the field and its suggestions. */
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOpen(false);
  };

  /**
   * Escape closes the list and returns focus to the field. The event must not
   * bubble: inside a <dialog> the browser would read the same keypress as a
   * close request and dismiss the whole modal.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || suggestions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    inputRef.current?.focus();
    setOpen(false);
  };

  const pick = (entry: CatchRefEntry) => {
    onChange(refLabel(entry, locale));
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="t-label">
        {label}
      </label>
      <div onBlur={handleBlur} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          data-autofocus={autoFocus ? true : undefined}
          id={id}
          type="text"
          maxLength={120}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Typing reopens a list that Escape closed.
            setOpen(true);
          }}
          // Opened by clicking or typing, never by focus alone: the field is
          // autofocused on mount and a list unfolding over the untouched form
          // would hide the fields below it before anything was asked for.
          onClick={() => setOpen(true)}
          placeholder={placeholder}
          style={{ anchorName } as CSSProperties}
          className={INPUT_CLASS}
        />
        {suggestions.length > 0 && (
          <div
            style={
              {
                positionAnchor: anchorName,
                positionArea: "block-end span-inline-end",
                // Without a fallback the list only ever opens downwards and runs off
                // the bottom of short windows. flip-block moves it above the field.
                positionTryFallbacks: "flip-block",
                width: "anchor-size(width)",
                marginBlockStart: "0.25rem",
              } as CSSProperties
            }
            className="fixed bg-bg-secondary border border-border-subtle rounded-none z-50 shadow-xl max-h-[min(13rem,45vh)] overflow-x-hidden overflow-y-auto"
          >
            {suggestions.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                // Keep the press from moving focus at all: browsers that do not
                // focus a clicked button (Safari) would otherwise blur the
                // field and unmount the row before its click fires.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(entry)}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                {refLabel(entry, locale)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Select field ---

interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  /** Label of the leading empty entry that clears the field. */
  readonly emptyLabel: string;
  readonly options: readonly CatchRefEntry[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly locale: string;
  /** Icon URL of one entry; omit for catalogs without icons. */
  readonly iconFor?: (slug: string) => string;
}

/** How long two keystrokes still count as one typeahead prefix, in ms. */
const TYPEAHEAD_WINDOW = 700;

/**
 * One labeled dropdown over a reference catalog.
 *
 * Built from a button and a popup instead of a native `<select>` because an
 * `<option>` cannot carry an image, and the ball and mark catalogs are far
 * easier to read with their game icons than by name alone. Trigger and popup
 * borrow the Tempest select skin (`t-select-wrap` draws the chevron), so the
 * field looks exactly like the native control it replaces.
 *
 * Keyboard support mirrors what the native control offered: the trigger opens
 * on Enter or Space and moves focus onto the current entry, entries are plain
 * focusable buttons and therefore Tab-reachable (WCAG 2.1.1), typing a few
 * letters jumps to the matching entry, and Escape closes without bubbling into
 * the surrounding dialog.
 */
export function SelectField({
  id,
  label,
  emptyLabel,
  options,
  value,
  onChange,
  locale,
  iconFor,
}: SelectFieldProps) {
  const instanceId = useId();
  const labelId = `${instanceId}-label`;
  // useId() yields colons, which are not valid in a CSS dashed-ident.
  const anchorName = `--select-${instanceId.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ prefix: "", at: 0 });
  const [open, setOpen] = useState(false);

  const currentLabel = value ? refLabelFor(options, value, locale) : emptyLabel;

  // Opening lands on the current entry, so the list starts where the native
  // control would have, instead of forcing a walk from the top.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const active = list?.querySelector<HTMLButtonElement>('[data-active="true"]');
    (active ?? list?.querySelector("button"))?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const pick = (slug: string) => {
    onChange(slug);
    close();
  };

  /** Closes the popup once focus leaves the trigger and the list. */
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOpen(false);
  };

  /**
   * Escape closes the popup, printable keys jump to the entry starting with
   * what was typed. Escape must not bubble: inside a <dialog> the browser
   * would read the same keypress as a close request for the whole modal.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    const prefix = now - typed.current.at > TYPEAHEAD_WINDOW ? e.key : typed.current.prefix + e.key;
    typed.current = { prefix, at: now };
    const needle = prefix.toLowerCase();
    const rows = [...(listRef.current?.querySelectorAll("button") ?? [])];
    const hit = rows.find((row) => row.textContent?.trim().toLowerCase().startsWith(needle));
    if (!hit) return;
    e.preventDefault();
    hit.focus();
  };

  const entries = [
    { slug: "", name: emptyLabel },
    ...options.map((entry) => ({
      slug: entry.slug,
      name: refLabel(entry, locale),
    })),
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="t-label">
        {label}
      </span>
      <div onBlur={handleBlur} onKeyDown={handleKeyDown}>
        <span className="t-select-wrap" style={{ anchorName } as CSSProperties}>
          <button
            ref={triggerRef}
            id={id}
            type="button"
            aria-expanded={open}
            aria-haspopup="true"
            // Self-reference keeps the visible entry name inside the accessible
            // name, which a bare aria-label would have replaced (WCAG 2.5.3).
            aria-labelledby={`${labelId} ${id}`}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            className="t-select text-sm flex items-center gap-2 text-left"
          >
            {iconFor && <IconSlot src={value ? iconFor(value) : ""} />}
            <span className="flex-1 min-w-0 truncate">{currentLabel}</span>
          </button>
        </span>

        {open && (
          <div
            ref={listRef}
            // Fixed instead of absolute: the dialog body scrolls and would clip
            // an absolutely positioned popup. CSS anchor positioning keeps the
            // box under the trigger without JS measuring; the properties are
            // not in React's CSSProperties yet.
            style={
              {
                positionAnchor: anchorName,
                positionArea: "block-end span-inline-end",
                // Without a fallback the list only ever opens downwards and runs off
                // the bottom of short windows. flip-block moves it above the field.
                positionTryFallbacks: "flip-block",
                width: "anchor-size(width)",
                marginBlockStart: "0.25rem",
              } as CSSProperties
            }
            className="fixed bg-bg-secondary border border-border-subtle rounded-none z-50 shadow-xl max-h-[min(13rem,45vh)] overflow-x-hidden overflow-y-auto"
          >
            {entries.map((entry) => (
              <button
                key={entry.slug || "none"}
                type="button"
                data-active={entry.slug === value ? "true" : undefined}
                aria-current={entry.slug === value ? "true" : undefined}
                // Keep the press from moving focus at all: browsers that do not
                // focus a clicked button (Safari) would otherwise blur the list
                // and unmount the row before its click fires.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(entry.slug)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${
                  entry.slug === value
                    ? "bg-accent-blue/10 text-accent-blue"
                    : "text-text-primary hover:bg-bg-hover"
                }`}
              >
                {iconFor && <IconSlot src={entry.slug ? iconFor(entry.slug) : ""} />}
                <span className="flex-1 min-w-0 truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
