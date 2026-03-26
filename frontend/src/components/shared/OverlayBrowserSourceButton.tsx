import { useState } from "react";
import { Check, Monitor } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { apiUrl } from "../../utils/api";

/** Compact button that copies the OBS Browser Source URL to clipboard. */
export function OverlayBrowserSourceButton({ pokemonId }: Readonly<{ pokemonId: string }>) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const pokemonUrl = `${baseUrl}/overlay/${pokemonId}`;

  const copy = () => {
    navigator.clipboard.writeText(pokemonUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={copy}
      title={pokemonUrl}
      aria-label={t("aria.copyObsUrl")}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border-subtle text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Monitor className="w-3.5 h-3.5" />}
      {copied ? t("overlay.urlCopied") : t("overlay.obsUrl")}
    </button>
  );
}
