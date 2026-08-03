/**
 * PanelSection.tsx: collapsible group for the property panel.
 *
 * The panel's common path stays short by parking the rarely touched rows behind
 * a disclosure. The header is a real button carrying aria-expanded and
 * aria-controls, so the collapsed state is announced and keyboard reachable.
 */

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** Collapsible titled group of property rows. */
export function PanelSection({
  title,
  children,
  defaultOpen = false,
}: Readonly<{
  title: string;
  children: ReactNode;
  /** Start expanded. Rare settings stay collapsed, which is the default. */
  defaultOpen?: boolean;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `${useId()}-panel`;

  return (
    <div className="border border-border-subtle rounded-none">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs 2xl:text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
      >
        <ChevronRight
          aria-hidden="true"
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="truncate">{title}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="border-t border-border-subtle px-2 py-2 space-y-1.5"
      >
        {children}
      </div>
    </div>
  );
}
