/**
 * AboutSection.tsx renders the "About" card of the settings page: project
 * license, the collapsible open-source license list, data sources and the
 * trademark notice. License data is fetched lazily on first expand.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Globe, Info, Scale } from "lucide-react";

import { LicenseDialog } from "./LicenseDialog";
import { apiUrl } from "../../utils/api";

/** Single third-party dependency license entry served by /api/licenses. */
interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  text: string;
  source: string;
}

/** Fetch the license list once the collapsible is opened for the first time. */
function useLazyLicenses(
  licensesOpen: boolean,
  count: number,
  setLicenses: (data: LicenseEntry[]) => void,
) {
  useEffect(() => {
    if (licensesOpen && count === 0) {
      fetch(apiUrl("/api/licenses"))
        .then((r) => r.json())
        .then((data: LicenseEntry[]) => setLicenses(data))
        .catch(() => {});
    }
  }, [licensesOpen, count, setLicenses]);
}

/** External data sources credited in the about card. */
const DATA_SOURCES: { name: string; url: string; desc: string; display?: string }[] = [
  { name: "PokéAPI", url: "https://pokeapi.co", desc: "Pokémon data & sprites" },
  { name: "PokéSprite", url: "https://github.com/msikma/pokesprite", desc: "Box sprites" },
  { name: "Pokémon Showdown", url: "https://pokemonshowdown.com", desc: "Animated sprites" },
  {
    name: "r/pokemon (Reddit)",
    url: "https://www.reddit.com/r/pokemon/comments/10wzzt9/these_are_all_the_hunting_methods_of_every_game/",
    desc: "Shiny odds & hunting methods",
    display: "reddit.com/r/pokemon",
  },
];

/**
 * AboutSection shows project licensing, third-party licenses, data sources
 * and the trademark notice inside a settings card.
 */
export function AboutSection({ t }: Readonly<{ t: (key: string) => string }>) {
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [trademarkOpen, setTrademarkOpen] = useState(false);
  const [licenses, setLicenses] = useState<LicenseEntry[]>([]);
  const [expandedLicense, setExpandedLicense] = useState<string | null>(null);
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);

  useLazyLicenses(licensesOpen, licenses.length, setLicenses);

  return (
    <section className="glass-card rounded-2xl p-6 space-y-4">
      <h2 className="text-sm 2xl:text-base font-semibold text-text-primary flex items-center gap-2">
        <Info className="w-4 h-4 text-text-muted" />
        {t("settings.sectionAbout")}
      </h2>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-text-muted">
          {t("licenses.project")}{" "}
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue hover:underline"
          >
            GNU AGPL-3.0
          </a>{"."}
        </p>
        <button
          onClick={() => setShowLicenseDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary hover:bg-bg-hover border border-border-subtle text-xs text-text-muted hover:text-text-primary transition-colors shrink-0"
        >
          <Scale className="w-3 h-3" />
          {t("license.showDialog")}
        </button>
      </div>

      {showLicenseDialog && (
        <LicenseDialog onAccept={() => setShowLicenseDialog(false)} />
      )}

      {/* Collapsible licenses */}
      <button
        onClick={() => setLicensesOpen(!licensesOpen)}
        className="w-full flex items-center justify-between py-1"
      >
        <span className="text-sm text-text-primary flex items-center gap-2">
          <Scale className="w-3.5 h-3.5 text-text-muted" />
          {t("licenses.title")}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${licensesOpen ? "rotate-180" : ""}`}
        />
      </button>

      {licensesOpen && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">{t("licenses.desc")}</p>
          {licenses.length === 0 ? (
            <p className="text-xs text-text-faint py-2">Loading…</p>
          ) : (
            <div className="space-y-1">
              {licenses.map((dep) => (
                <div
                  key={`${dep.source}-${dep.name}`}
                  className="bg-bg-secondary/30 border border-border-subtle rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedLicense(
                        expandedLicense === dep.name ? null : dep.name,
                      )
                    }
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-bg-hover/50 transition-colors"
                  >
                    <span className="text-xs text-text-primary font-medium flex-1 min-w-0 truncate">
                      {dep.name}
                    </span>
                    <span className="text-[10px] text-text-faint shrink-0">
                      {dep.version}
                    </span>
                    <span className="inline-block px-1.5 py-0.5 rounded bg-bg-secondary border border-border-subtle text-text-muted font-mono text-[10px] shrink-0">
                      {dep.license}
                    </span>
                    <ChevronDown
                      className={`w-3 h-3 text-text-faint transition-transform duration-150 shrink-0 ${expandedLicense === dep.name ? "rotate-180" : ""}`}
                    />
                  </button>
                  {expandedLicense === dep.name && dep.text && (
                    <pre className="px-3 py-2 text-[10px] leading-relaxed text-text-muted border-t border-border-subtle/50 max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word">
                      {dep.text}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Data Sources & APIs */}
      <button
        onClick={() => setDataSourcesOpen(!dataSourcesOpen)}
        className="w-full flex items-center justify-between py-1"
      >
        <span className="text-sm text-text-primary flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-text-muted" />
          {t("licenses.dataSources")}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${dataSourcesOpen ? "rotate-180" : ""}`}
        />
      </button>

      {dataSourcesOpen && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">{t("licenses.dataSourcesDesc")}</p>
          <div className="space-y-1">
            {DATA_SOURCES.map((src) => (
              <div
                key={src.name}
                className="bg-bg-secondary/30 border border-border-subtle rounded-lg px-3 py-2 flex items-center gap-3"
              >
                <span className="text-xs text-text-primary font-medium flex-1 min-w-0 truncate">
                  {src.name}
                </span>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-accent-blue hover:underline shrink-0"
                >
                  {src.display ?? src.url.replace("https://", "")}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trademark Notice */}
      <button
        onClick={() => setTrademarkOpen(!trademarkOpen)}
        className="w-full flex items-center justify-between py-1"
      >
        <span className="text-sm text-text-primary flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-text-muted" />
          {t("licenses.trademarkTitle")}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${trademarkOpen ? "rotate-180" : ""}`}
        />
      </button>

      {trademarkOpen && (
        <p className="text-xs text-text-muted leading-relaxed">
          {t("licenses.trademark")}
        </p>
      )}
    </section>
  );
}
