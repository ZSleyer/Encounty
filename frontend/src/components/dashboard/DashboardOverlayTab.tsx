/**
 * DashboardOverlayTab.tsx: Overlay tab of the right-hand panel.
 *
 * Switches a hunt between the global and its own overlay layout, hosts the
 * embedded editor for the custom case and offers the import dropdown.
 */

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Globe,
  Monitor,
  Pencil,
  RefreshCw,
  Save,
} from "lucide-react";
import { Link } from "react-router";
import { OverlaySettings, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { useAnchorName, anchorTriggerStyle, anchoredMenuStyle } from "../../utils/anchoredMenu";
import { apiUrl } from "../../utils/api";
import { copyWithFlag } from "../../utils/clipboard";
import { OverlayBrowserSourceButton } from "../shared/OverlayBrowserSourceButton";
import { OverlayEditor } from "../overlay-editor/OverlayEditor";
import { OverlayImportItem } from "./OverlayImportItem";

/** Card-style OBS URL copy button for the global overlay placeholder. */
function ObsUrlCardButton({ pokemonId }: Readonly<{ pokemonId: string }>) {
  const { t } = useI18n();
  const { push, dismissByKey } = useToast();
  const [copied, setCopied] = useState(false);
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const url = `${baseUrl}/overlay/${pokemonId}`;

  const copy = () => {
    copyWithFlag(url, setCopied, {
      onSuccess: () => dismissByKey("clipboard-copy"),
      onError: () =>
        push({ type: "error", title: t("overlay.errCopyFailed"), key: "clipboard-copy" }),
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      aria-label={t("aria.copyObsUrl")}
      className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-none bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-text-secondary hover:text-accent-blue transition-colors"
    >
      {copied ? <Check className="w-4 h-4 text-accent-green" /> : <Monitor className="w-4 h-4" />}
      <span className="text-[10px] font-medium">
        {copied ? t("overlay.urlCopied") : t("overlay.obsUrl")}
      </span>
    </button>
  );
}

/** Overlay tab content, extracted to reduce Dashboard cognitive complexity. */
export function DashboardOverlayTab({
  pokemon,
  overlaySaving,
  overlaySaved,
  overlayDirty,
  currentOverlay,
  allPokemon,
  onModeChange,
  onSave,
  onCopyFrom,
  onOverlayUpdate,
}: Readonly<{
  pokemon: Pokemon;
  overlaySaving: boolean;
  overlaySaved: boolean;
  overlayDirty: boolean;
  currentOverlay: OverlaySettings | null;
  allPokemon: Pokemon[];
  onModeChange: (mode: "default" | "custom") => void;
  onSave: () => void;
  onCopyFrom: (sourceId: string) => void;
  onOverlayUpdate: (overlay: OverlaySettings) => void;
}>) {
  const { t } = useI18n();
  const importMenuAnchor = useAnchorName("overlay-import");
  const overlayMode = pokemon.overlay_mode || "default";
  const modeBase = overlayMode === "custom" ? "custom" : "default";

  const saveIcon = overlaySaving ? (
    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
  ) : (
    <Save className="w-3.5 h-3.5" />
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Control bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-card border-b border-border-subtle shrink-0">
        <OverlayBrowserSourceButton pokemonId={pokemon.id} />

        {modeBase === "custom" && overlaySaved && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] font-medium bg-accent-green/10 text-accent-green border border-accent-green/20 shrink-0">
            <Save className="w-3 h-3" />
            {t("overlay.saved")}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => onModeChange("default")}
          title={t("dash.tooltipOverlayGlobal")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-none text-xs font-semibold transition-colors shrink-0 ${
            modeBase === "default"
              ? "bg-accent-blue/15 text-accent-blue"
              : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          {t("overlay.global")}
        </button>
        <button
          onClick={() => onModeChange("custom")}
          title={t("dash.tooltipOverlayCustom")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-none text-xs font-semibold transition-colors shrink-0 ${
            modeBase === "custom"
              ? "bg-accent-purple/15 text-accent-purple"
              : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          {t("overlay.modeCustom")}
        </button>

        {modeBase === "custom" && (
          <div className="relative group shrink-0">
            <button
              style={anchorTriggerStyle(importMenuAnchor)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-none text-xs font-semibold bg-bg-primary border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent-blue/30 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {t("overlay.import")}
              <ChevronDown className="w-3 h-3" />
            </button>
            <div
              style={anchoredMenuStyle(importMenuAnchor, "below-end")}
              className="fixed w-52 bg-bg-secondary border border-border-subtle rounded-none shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1 overflow-y-auto"
            >
              <button
                onClick={() => onCopyFrom("global")}
                className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-bg-primary transition-colors flex items-center gap-2"
              >
                <Globe className="w-3.5 h-3.5 text-text-muted" />
                {t("overlay.globalLayout")}
              </button>
              {allPokemon
                .filter((p) => p.id !== pokemon.id && p.overlay)
                .map((p) => (
                  <OverlayImportItem key={p.id} pokemon={p} onCopy={onCopyFrom} />
                ))}
            </div>
          </div>
        )}

        {modeBase === "custom" && (
          <button
            onClick={onSave}
            disabled={!overlayDirty || overlaySaving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-none bg-accent-blue hover:bg-accent-blue/90 text-white font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {saveIcon}
            {t("overlay.save")}
          </button>
        )}
      </div>

      {modeBase === "default" && currentOverlay && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
          <div className="text-center space-y-4 max-w-sm">
            <Globe className="w-10 h-10 text-text-muted mx-auto" />
            <p className="text-sm text-text-secondary">{t("overlay.usesGlobalDesc")}</p>
            <p className="text-xs text-text-muted leading-relaxed">
              {t("overlay.globalChangeNote")}
            </p>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Link
                to="/overlay-editor"
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-none bg-bg-card border border-border-subtle hover:border-accent-blue/40 hover:bg-accent-blue/5 text-text-secondary hover:text-accent-blue transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="text-[10px] font-medium">{t("overlay.editGlobal")}</span>
              </Link>
              <button
                type="button"
                onClick={() => onModeChange("custom")}
                className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-none bg-bg-card border border-border-subtle hover:border-accent-purple/40 hover:bg-accent-purple/5 text-text-secondary hover:text-accent-purple transition-colors"
              >
                <Pencil className="w-4 h-4" />
                <span className="text-[10px] font-medium">{t("overlay.switchToCustom")}</span>
              </button>
              <ObsUrlCardButton pokemonId={pokemon.id} />
            </div>
          </div>
        </div>
      )}

      {modeBase === "custom" && currentOverlay && (
        <div className="flex-1 min-h-0">
          <OverlayEditor
            settings={currentOverlay}
            activePokemon={pokemon || undefined}
            previewPokemonList={allPokemon}
            overlayTargetId={pokemon.id}
            onUpdate={onOverlayUpdate}
            compact
          />
        </div>
      )}
    </div>
  );
}
