/**
 * SidebarGroupSection.tsx — Collapsible group header plus Pokémon list body.
 *
 * Renders one sidebar group (real group from `/api/groups` or the synthetic
 * "ungrouped" bucket). The header is keyboard-accessible (Enter/Space to
 * toggle collapse) and carries an optional kebab menu for rename/color/
 * start/stop/delete actions. The body is rendered as children so the caller
 * keeps full control over the Pokémon card layout.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MoreVertical, Play, Square, Pencil, Palette, Trash2 } from "lucide-react";
import type { Group } from "../../types";
import { useI18n } from "../../contexts/I18nContext";

/** Actions the overflow menu can trigger for a real group. */
export type GroupAction = "rename" | "color" | "start" | "stop" | "delete";

interface SidebarGroupSectionProps {
  /** Null for the synthetic "ungrouped" bucket; real Group otherwise. */
  readonly group: Group | null;
  /** Display label — translated "Ungrouped" for null groups, group.name otherwise. */
  readonly label: string;
  /** Number of Pokémon visible in this section after filters. */
  readonly count: number;
  /** Controlled collapsed state. For null-group, parent keeps its own flag. */
  readonly collapsed: boolean;
  /** Toggle callback — parent persists to backend for real groups. */
  readonly onToggleCollapse: () => void;
  /** Optional menu handler; when omitted the menu button is hidden. */
  readonly onAction?: (action: GroupAction) => void;
  /** Body content (usually the <li> Pokémon items) rendered inside the section. */
  readonly children: React.ReactNode;
}

/**
 * Renders a sidebar group section with a clickable header row and a
 * collapsible body. Non-button ancestors are used so action buttons inside
 * the body never end up nested in another button.
 */
export function SidebarGroupSection({
  group,
  label,
  count,
  collapsed,
  onToggleCollapse,
  onAction,
  children,
}: SidebarGroupSectionProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Close menu on Escape for accessibility.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [menuOpen]);

  const color = group?.color || "#6b7280";
  const chevron = collapsed ? (
    <ChevronRight className="w-3 h-3" aria-hidden="true" />
  ) : (
    <ChevronDown className="w-3 h-3" aria-hidden="true" />
  );

  const handleMenuAction = (action: GroupAction) => {
    setMenuOpen(false);
    onAction?.(action);
  };

  return (
    <section aria-label={label} data-testid="sidebar-group-section">
      {/* Header — uses two sibling buttons (toggle + menu) inside a div
          to avoid invalid nested <button> markup. */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary/30 border-b border-border-subtle/50 sticky top-0 backdrop-blur-sm z-10">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-text-secondary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue rounded px-0.5 py-0.5"
        >
          {chevron}
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/20"
            style={{ backgroundColor: color }}
          />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider truncate">
            {label}
          </h3>
          <span className="text-[10px] text-text-muted tabular-nums shrink-0">
            ({count})
          </span>
        </button>
        {onAction && (
          <div className="relative">
            <button
              ref={menuBtnRef}
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("group.manage")}
              className="p-1 rounded text-text-faint hover:text-text-primary hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            >
              <MoreVertical className="w-3.5 h-3.5" />
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
                  aria-label={label}
                  className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-subtle rounded-lg shadow-lg py-1 min-w-44"
                >
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => handleMenuAction("start")}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 text-accent-green" />
                    {t("group.startAll")}
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => handleMenuAction("stop")}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                  >
                    <Square className="w-3.5 h-3.5 text-accent-red" />
                    {t("group.stopAll")}
                  </button>
                  <div className="h-px bg-border-subtle my-1" />
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => handleMenuAction("rename")}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t("group.rename")}
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => handleMenuAction("color")}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors"
                  >
                    <Palette className="w-3.5 h-3.5" />
                    {t("group.color")}
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => handleMenuAction("delete")}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-accent-red hover:bg-bg-primary transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t("group.delete")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {!collapsed && <div>{children}</div>}
    </section>
  );
}
