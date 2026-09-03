/**
 * sections.tsx: Registry of the settings sections and the tabs they belong to.
 *
 * Holds the static section metadata (title key, icon, owning tab, search
 * keywords) plus the derived tab list. The icons are JSX, hence the .tsx
 * extension on an otherwise data-only module.
 */

import { FolderOpen, Database, ArchiveRestore, Image, Info, Shield } from "lucide-react";

/** Identifier of a settings tab. Each section is assigned to exactly one tab. */
export type SettingsTab = "appearance" | "data" | "output" | "system" | "about";

/** Static definition of a settings section: identity, icon and search keywords. */
export interface SectionDef {
  readonly id: string;
  readonly titleKey: string;
  readonly icon: React.ReactNode;
  readonly tab: SettingsTab;
  readonly keywords: string[];
}

/** Sections available on every platform, in render order. */
export const BASE_SECTIONS: SectionDef[] = [
  {
    id: "display",
    titleKey: "settings.sectionDisplay",
    icon: <Image className="w-4 h-4 text-accent-blue" />,
    tab: "appearance",
    keywords: [
      "sprite",
      "crisp",
      "pixel",
      "scharf",
      "darstellung",
      "display",
      "language",
      "sprache",
      "theme",
      "dark",
      "light",
      "dunkel",
      "hell",
      "locale",
      "accent",
      "akzent",
      "farbe",
      "color",
      "motion",
      "animation",
      "animationen",
      "reduce",
      "bewegung",
    ],
  },
  {
    id: "output",
    titleKey: "settings.sectionOutput",
    icon: <FolderOpen className="w-4 h-4 text-accent-yellow" />,
    tab: "output",
    keywords: ["obs", "datei", "file", "output", "ausgabe", "text", "folder"],
  },
  {
    id: "data",
    titleKey: "settings.sectionData",
    icon: <Database className="w-4 h-4 text-accent-blue" />,
    tab: "data",
    keywords: ["sync", "daten", "data", "pokemon", "pokédex", "spiel", "game", "api", "update"],
  },
  {
    id: "backup",
    titleKey: "settings.sectionBackup",
    icon: <ArchiveRestore className="w-4 h-4 text-accent-purple" />,
    tab: "data",
    keywords: ["backup", "restore", "sicherung", "wiederherstellen", "export", "import", "zip"],
  },
  {
    id: "about",
    titleKey: "settings.sectionAbout",
    icon: <Info className="w-4 h-4 text-text-muted" />,
    tab: "about",
    keywords: [
      "about",
      "über",
      "lizenz",
      "license",
      "version",
      "info",
      "pokeapi",
      "showdown",
      "api",
    ],
  },
];

/** macOS-only section exposing the accessibility and screen recording grants. */
export const PERMISSIONS_SECTION: SectionDef = {
  id: "permissions",
  titleKey: "settings.sectionPermissions",
  icon: <Shield className="w-4 h-4 text-accent-green" />,
  tab: "system",
  keywords: ["permissions", "berechtigungen", "accessibility", "screen", "recording", "macos"],
};

/** Build the sections array, conditionally including macOS permissions. */
export function buildSections(): SectionDef[] {
  if (globalThis.electronAPI?.platform === "darwin") {
    // Insert permissions before the about section
    const sections = [...BASE_SECTIONS];
    const aboutIdx = sections.findIndex((s) => s.id === "about");
    sections.splice(aboutIdx, 0, PERMISSIONS_SECTION);
    return sections;
  }
  return BASE_SECTIONS;
}

/** Sections available on the current platform. */
export const SECTIONS = buildSections();

/** Static definition of a settings tab: identifier plus i18n label key. */
export interface TabDef {
  readonly id: SettingsTab;
  readonly labelKey: string;
}

/** Every tab the page knows about, in display order. */
export const TAB_ORDER: TabDef[] = [
  { id: "appearance", labelKey: "settings.tabAppearance" },
  { id: "data", labelKey: "settings.tabData" },
  { id: "output", labelKey: "settings.tabOutput" },
  { id: "system", labelKey: "settings.tabSystem" },
  { id: "about", labelKey: "settings.tabAbout" },
];

/** Tabs that own at least one section on this platform (system is macOS only). */
export const TABS: TabDef[] = TAB_ORDER.filter((tab) => SECTIONS.some((s) => s.tab === tab.id));
