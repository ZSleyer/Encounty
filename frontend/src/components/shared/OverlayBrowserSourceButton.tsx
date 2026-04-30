import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Monitor } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";

type UrlMode = "pokemon" | "universal";

/**
 * Split button that copies an OBS Browser Source URL to the clipboard.
 *
 * The primary action copies the currently selected URL mode, while the
 * chevron opens a menu for choosing between the per-Pokemon URL and a
 * universal URL that mirrors the active Pokemon on the server side.
 */
export function OverlayBrowserSourceButton({ pokemonId }: Readonly<{ pokemonId: string }>) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<UrlMode>("pokemon");
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  const baseUrl = apiUrl("") || globalThis.location.origin;
  const pokemonUrl = `${baseUrl}/overlay/${pokemonId}`;
  const universalUrl = `${baseUrl}/overlay`;
  const currentUrl = mode === "universal" ? universalUrl : pokemonUrl;
  const currentLabel = mode === "universal" ? t("overlay.url.universal") : t("overlay.url.perPokemon");

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handlePrimaryClick = () => {
    copyUrl(currentUrl);
  };

  const handleSelect = (next: UrlMode) => {
    setMode(next);
    setMenuOpen(false);
    copyUrl(next === "universal" ? universalUrl : pokemonUrl);
    chevronRef.current?.focus();
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen]);

  // Close on Escape + keyboard navigation inside menu
  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIdx = Array.from(items).findIndex((el) => el === active);

    if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
      chevronRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = currentIdx < 0 ? 0 : (currentIdx + 1) % items.length;
      items[next].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = currentIdx < 0 ? items.length - 1 : (currentIdx - 1 + items.length) % items.length;
      items[prev].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === "Tab") {
      // Trap focus within the open menu
      e.preventDefault();
      const delta = e.shiftKey ? -1 : 1;
      const idx = currentIdx < 0 ? 0 : currentIdx;
      const next = (idx + delta + items.length) % items.length;
      items[next].focus();
    }
  };

  // Focus the first menu item when opening via keyboard
  const openMenu = () => {
    setMenuOpen(true);
    // Defer so the menu exists when we try to focus
    setTimeout(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      first?.focus();
    }, 0);
  };

  const handleChevronKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* Primary copy button */}
      <button
        type="button"
        onClick={handlePrimaryClick}
        title={currentUrl}
        aria-label={t("aria.copyObsUrl")}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-l-lg border border-border-subtle border-r-0 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Monitor className="w-3.5 h-3.5" />}
        {copied ? t("overlay.urlCopied") : currentLabel}
      </button>

      {/* Dropdown chevron */}
      <button
        type="button"
        ref={chevronRef}
        onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
        onKeyDown={handleChevronKeyDown}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={t("overlay.url.dropdownAria")}
        className="inline-flex items-center justify-center px-2 py-2 rounded-r-lg border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue min-w-[28px]"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <ul
          ref={menuRef}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full mt-1 z-50 min-w-[240px] rounded-lg border border-border-subtle bg-bg-secondary shadow-lg py-1"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => handleSelect("pokemon")}
              className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:bg-bg-hover hover:bg-bg-hover ${
                mode === "pokemon" ? "text-accent-blue" : "text-text-secondary"
              }`}
            >
              <div className="flex items-center gap-2">
                {mode === "pokemon" ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5" />}
                <span>{t("overlay.url.perPokemon")}</span>
              </div>
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => handleSelect("universal")}
              className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:bg-bg-hover hover:bg-bg-hover ${
                mode === "universal" ? "text-accent-blue" : "text-text-secondary"
              }`}
            >
              <div className="flex items-center gap-2">
                {mode === "universal" ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5" />}
                <span>{t("overlay.url.universal")}</span>
              </div>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
