/**
 * RegionEditCard.tsx -- Editor row for a single detection region.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Loader2, ScanText, Trash2 } from "lucide-react";
import { MatchedRegion } from "../../types";
import { categoryColor } from "./templateCategories";

/** Single region editor card shown below the snapshot preview. */
export function RegionEditCard({
  region: r,
  index: i,
  onUpdate,
  onDelete,
  onRunOCR,
  isRecognizing,
  categoryNames,
  t,
}: Readonly<{
  region: MatchedRegion;
  index: number;
  onUpdate: (i: number, u: Partial<MatchedRegion>) => void;
  onDelete: (i: number) => void;
  onRunOCR: (i: number) => void;
  isRecognizing: boolean;
  /** Distinct category names already used in this template, for autocomplete and chip colors. */
  categoryNames: string[];
  t: (key: string) => string;
}>) {
  const labelColor = r.type === "text" ? "text-[#3fd4e0]" : "text-accent-blue";
  const datalistId = `region-categories-${i}`;
  const chipColor = categoryColor(r.category, categoryNames);
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="flex items-center gap-2 bg-bg-card border border-border-subtle rounded-none px-3 py-2 transition-colors hover:border-accent-blue/50">
      <span className={`font-mono font-bold w-5 shrink-0 ${labelColor}`}>#{i + 1}</span>
      <select
        className="bg-bg-primary text-text-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded-none border border-border-subtle outline-none min-w-25 2xl:min-w-30"
        aria-label={t("templateEditor.regionType")}
        value={r.type}
        onChange={(e) => onUpdate(i, { type: e.target.value as "image" | "text" })}
      >
        <option value="image">{t("templateEditor.regionImage")}</option>
        <option value="text">{t("templateEditor.regionText")} (OCR)</option>
      </select>
      {r.type === "text" && (
        <>
          <input
            type="text"
            placeholder={t("templateEditor.expectedText")}
            value={r.expected_text}
            onChange={(e) => onUpdate(i, { expected_text: e.target.value })}
            className="bg-bg-primary text-text-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded-none border border-border-subtle outline-none min-w-30 2xl:min-w-35 focus:border-[#3fd4e0]"
          />
          <button
            title="Auto-recognize text (OCR)"
            onClick={() => onRunOCR(i)}
            disabled={isRecognizing}
            className="text-accent-yellow hover:text-accent-yellow/80 disabled:opacity-40 transition-colors p-1"
          >
            {isRecognizing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ScanText className="w-4 h-4 2xl:w-5 2xl:h-5" />
            )}
          </button>
        </>
      )}
      <div className="w-px h-6 bg-border-subtle mx-1"></div>
      <div className="flex items-center gap-1.5">
        {chipColor && (
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: chipColor }}
          />
        )}
        <input
          type="text"
          list={datalistId}
          aria-label={t("templateEditor.category")}
          placeholder={t("templateEditor.category")}
          value={r.category ?? ""}
          onChange={(e) => onUpdate(i, { category: e.target.value })}
          className="bg-bg-primary text-text-primary text-xs 2xl:text-sm p-1 2xl:p-1.5 rounded-none border border-border-subtle outline-none w-24 2xl:w-28 focus:border-accent-blue"
        />
        <datalist id={datalistId}>
          {categoryNames.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          aria-label={t("templateEditor.categoryHelpTitle")}
          className="text-text-muted hover:text-accent-blue transition-colors shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
        </button>
        {showHelp &&
          createPortal(
            <div
              className="fixed inset-0 z-100 flex items-center-safe justify-center-safe overflow-y-auto bg-black/60 p-4"
              onClick={() => setShowHelp(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowHelp(false);
              }}
              role="presentation"
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={t("templateEditor.categoryHelpTitle")}
                className="max-w-sm bg-bg-card border border-border-subtle rounded-none p-4 text-left"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 mb-2 text-text-primary font-semibold text-sm">
                  <HelpCircle className="w-4 h-4 text-accent-blue" />
                  <span>{t("templateEditor.categoryHelpTitle")}</span>
                </div>
                <p className="text-xs 2xl:text-sm text-text-secondary leading-relaxed">
                  {t("templateEditor.categoryHelp")}
                </p>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowHelp(false)}
                    className="t-cut px-3 py-1.5 rounded-none bg-accent-blue text-bg-primary text-xs font-semibold hover:bg-accent-blue/90 transition-colors"
                  >
                    {t("templateEditor.close")}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
      <div className="w-px h-6 bg-border-subtle mx-1"></div>
      <button
        title={t("templateEditor.deleteRegion")}
        onClick={() => onDelete(i)}
        className="text-text-muted hover:text-accent-red transition-colors p-1"
      >
        <Trash2 className="w-4 h-4 2xl:w-5 2xl:h-5" />
      </button>
    </div>
  );
}
