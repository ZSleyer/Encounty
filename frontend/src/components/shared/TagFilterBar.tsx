/**
 * TagFilterBar.tsx — Sidebar tag filter control.
 *
 * Renders currently-active tag filters as removable chips plus a small
 * "+" button that opens a dropdown for picking additional tags from the
 * pool of tags that are not yet in the active filter set.
 */
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { TagChip } from "./TagChip";

interface TagFilterBarProps {
  readonly activeTags: string[];
  readonly availableTags: string[];
  readonly onToggle: (tag: string) => void;
  readonly onClear: () => void;
}

/**
 * Sidebar filter bar that shows removable chips for each active tag and a
 * dropdown to add more from the available pool. Intentionally renders
 * nothing when both the active and available sets are empty to keep the
 * sidebar compact.
 */
export function TagFilterBar({
  activeTags,
  availableTags,
  onToggle,
  onClear,
}: TagFilterBarProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Tags not already in the active filter set are candidates for the dropdown.
  const pickable = availableTags.filter((t) => !activeTags.includes(t));

  // Reset highlight when the pickable list changes (e.g. after selecting a tag).
  useEffect(() => {
    setHighlightIdx(0);
  }, [pickable.length, menuOpen]);

  // Close the menu on Escape and handle basic arrow-key navigation.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, pickable.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (pickable[highlightIdx]) {
          e.preventDefault();
          onToggle(pickable[highlightIdx]);
          setMenuOpen(false);
        }
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [menuOpen, pickable, highlightIdx, onToggle]);

  // Hide the bar entirely when there is nothing to show and nothing to pick.
  if (activeTags.length === 0 && availableTags.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-border-subtle"
      aria-label={t("tag.filter")}
    >
      {activeTags.map((tag) => (
        <TagChip
          key={tag}
          tag={tag}
          active
          removable
          onRemove={() => onToggle(tag)}
        />
      ))}

      {pickable.length > 0 && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("tag.add")}
            className="inline-flex items-center gap-0.5 min-h-[24px] min-w-[24px] px-1.5 py-0.5 rounded-full text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          >
            <Plus className="w-3 h-3" />
            <span className="sr-only">{t("tag.add")}</span>
          </button>
          {menuOpen && (
            <>
              <button
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenuOpen(false)}
                aria-label={t("aria.close")}
              />
              <div
                role="menu"
                aria-label={t("tag.filter")}
                className="absolute left-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-lg shadow-lg py-1 min-w-36 max-h-60 overflow-y-auto"
              >
                {pickable.map((tag, idx) => (
                  <button
                    key={tag}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onToggle(tag);
                      setMenuOpen(false);
                    }}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`flex items-center w-full px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors ${
                      idx === highlightIdx ? "bg-bg-primary" : "hover:bg-bg-primary"
                    }`}
                  >
                    <TagChip tag={tag} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTags.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto inline-flex items-center gap-1 min-h-[24px] text-[10px] text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue rounded"
          aria-label={t("tag.clearFilters")}
        >
          <X className="w-3 h-3" />
          {t("tag.clearFilters")}
        </button>
      )}
    </div>
  );
}
