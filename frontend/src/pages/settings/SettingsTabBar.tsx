/**
 * SettingsTabBar.tsx: Horizontal tab list at the top of the settings page.
 */

import { useRef } from "react";

import { TABS, type SettingsTab } from "./sections";

/**
 * SettingsTabBar renders the horizontal tab list switching between settings
 * tabs. Implements the WAI-ARIA tabs pattern with a roving tabindex:
 * ArrowLeft/ArrowRight cycle through tabs, Home/End jump to first/last, and
 * moving focus also activates the focused tab.
 */
export function SettingsTabBar({
  activeTab,
  onSelect,
  t,
}: Readonly<{
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  t: (key: string) => string;
}>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === -1) return;
    e.preventDefault();
    onSelect(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t("settings.title")}
      // Scrolls instead of wrapping: every wrapped line costs height, and on a
      // short window that height is exactly what the panel below needs.
      // overflow-y-hidden is required: a non-visible overflow-x makes the y axis
      // compute to auto, and the tabs' fractional height then yields a stray
      // vertical scrollbar.
      className="flex items-center overflow-x-auto overflow-y-hidden border-b border-border-subtle"
    >
      {TABS.map((tab, idx) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`shrink-0 -mb-px px-3 py-2 text-[11px] 2xl:text-xs font-semibold uppercase tracking-[0.14em] whitespace-nowrap border-b-2 rounded-none transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-blue ${
              selected
                ? "text-accent-blue border-accent-blue"
                : "text-text-muted border-transparent hover:text-text-primary"
            }`}
          >
            {t(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
