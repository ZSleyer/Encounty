/**
 * RibbonPicker.tsx: Ribbon selection block of the catch metadata dialog, a
 * filter field over the flat ribbon catalog plus one toggle per ribbon.
 */
import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { CatchIcon, getRibbonIconUrl } from "../../utils/catchIcons";
import { refLabel, refLabelFor, type RibbonRef } from "../../hooks/useCatchRefs";
import { INPUT_CLASS } from "./catchMetaFields";

interface RibbonPickerProps {
  readonly labelId: string;
  readonly ribbons: readonly RibbonRef[];
  readonly selected: readonly string[];
  readonly locale: string;
  readonly onToggle: (slug: string) => void;
}

/**
 * Ribbon selection: a filter field over the flat catalog plus a toggle
 * button per ribbon, with the current selection repeated as removable chips.
 */
export function RibbonPicker({ labelId, ribbons, selected, locale, onToggle }: RibbonPickerProps) {
  const { t } = useI18n();
  const filterId = useId();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ribbons;
    return ribbons.filter((entry) => refLabel(entry, locale).toLowerCase().includes(needle));
  }, [ribbons, query, locale]);

  const nameOf = (slug: string) => refLabelFor(ribbons, slug, locale);

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="t-label self-start">
        {t("catchMeta.ribbons")}
      </span>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 min-h-[24px] pl-1.5 pr-1 py-0.5 rounded-none border border-border-subtle bg-bg-secondary text-[11px] text-text-secondary"
            >
              <CatchIcon src={getRibbonIconUrl(slug)} className="w-4 h-4 object-contain shrink-0" />
              {nameOf(slug)}
              {/* Sibling button, never nested inside another interactive element. */}
              <button
                type="button"
                onClick={() => onToggle(slug)}
                aria-label={t("aria.catchMetaRibbonToggle", { name: nameOf(slug) })}
                className="p-0.5 min-h-[24px] rounded-none text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-faint">{t("catchMeta.ribbonEmpty")}</p>
      )}

      <label htmlFor={filterId} className="sr-only">
        {t("catchMeta.ribbonSearch")}
      </label>
      <input
        id={filterId}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("catchMeta.ribbonSearch")}
        className={INPUT_CLASS}
      />

      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto"
      >
        {visible.map((entry) => {
          const name = refLabel(entry, locale);
          const active = selected.includes(entry.slug);
          return (
            <button
              key={entry.slug}
              type="button"
              onClick={() => onToggle(entry.slug)}
              aria-pressed={active}
              aria-label={t("aria.catchMetaRibbonToggle", { name })}
              className={`inline-flex items-center gap-1 min-h-[24px] pl-1.5 pr-2 py-1 rounded-none border text-[11px] transition-colors ${
                active
                  ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                  : "border-border-subtle text-text-muted hover:text-text-primary"
              }`}
            >
              <CatchIcon
                src={getRibbonIconUrl(entry.slug)}
                className="w-4 h-4 object-contain shrink-0"
              />
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
