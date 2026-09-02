/**
 * OBS browser source hint of the overlay editor: shows the overlay URL of the
 * selected hunt and offers copying it or opening it in a browser tab.
 */
import { useState } from "react";
import { Monitor, Copy, ExternalLink } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { apiUrl } from "../../utils/api";
import { copyWithFlag } from "../../utils/clipboard";

/** Panel showing the overlay URL a streamer points an OBS browser source at. */
export function OBSSourceHint({ pokemonId }: Readonly<{ pokemonId?: string }>) {
  const { t } = useI18n();
  const { push, dismissByKey } = useToast();
  const [copied, setCopied] = useState(false);
  const baseUrl = apiUrl("") || globalThis.location.origin;
  const pokemonUrl = pokemonId ? `${baseUrl}/overlay/${pokemonId}` : null;

  const copy = (url: string) => {
    copyWithFlag(url, setCopied, {
      onSuccess: () => dismissByKey("clipboard-copy"),
      onError: () =>
        push({ type: "error", title: t("overlay.errCopyFailed"), key: "clipboard-copy" }),
    });
  };

  return (
    <div>
      <div className="flex items-center gap-1 text-xs 2xl:text-sm text-text-muted mb-1.5">
        <Monitor className="w-3 h-3 2xl:w-4 2xl:h-4" />
        OBS Browser Source:
      </div>
      {pokemonUrl ? (
        <>
          <div className="bg-bg-primary rounded-none px-2 py-1.5 2xl:px-2.5 2xl:py-2 mb-1.5">
            <code className="text-[10px] 2xl:text-xs text-accent-blue break-all">{pokemonUrl}</code>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => copy(pokemonUrl)}
              className="flex items-center gap-1 px-2 py-1 2xl:px-2.5 2xl:py-1.5 rounded-none text-[10px] 2xl:text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            >
              <Copy className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
              {copied ? t("overlay.copied") : t("overlay.copy")}
            </button>
            <a
              href={pokemonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 2xl:px-2.5 2xl:py-1.5 rounded-none text-[10px] 2xl:text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            >
              <ExternalLink className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
            </a>
          </div>
        </>
      ) : (
        <p className="text-[10px] 2xl:text-xs text-text-faint">{t("overlay.selectPokemon")}</p>
      )}
    </div>
  );
}
