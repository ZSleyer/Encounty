/**
 * native-strings.ts carries the translations for the surfaces the main process
 * renders itself: the zombie backend prompt, the startup failure box, the macOS
 * menu labels and the macOS About panel.
 */

import { app } from "electron";

/** UI locales the app ships, mirroring frontend/src/locales/index.ts. */
const NATIVE_LOCALES = ["de", "en", "es", "fr", "ja"] as const;

/** One of the locales the native surfaces are translated into. */
type NativeLocale = (typeof NATIVE_LOCALES)[number];

/** Everything the main process puts in front of the user without the renderer. */
export interface NativeStrings {
  /** Prompt shown when an orphaned backend still holds the port. */
  zombie: {
    message: string;
    /** Takes the process id and the blocked port. */
    detail: (pid: number, port: number) => string;
    replace: string;
    quit: string;
  };
  /** Error box shown when the app cannot come up at all. */
  startFailed: {
    title: string;
    /** Takes the underlying error message, which stays untranslated. */
    detail: (reason: string) => string;
  };
  /** macOS application menu. The entries themselves are roles the OS localizes. */
  menu: {
    edit: string;
    window: string;
  };
  /** macOS About panel. */
  about: {
    credits: string;
  };
}

/**
 * Translations for the native surfaces the main process owns.
 *
 * The renderer's i18n bundle is out of reach here: it lives in the frontend
 * build, and these strings are needed before a window exists or without one at
 * all. A handful of strings does not justify pulling that bundle into the main
 * process, so they are kept inline and stay in sync with frontend/src/locales
 * by hand.
 */
const NATIVE_STRINGS: Record<NativeLocale, NativeStrings> = {
  de: {
    zombie: {
      message: "Ein Encounty-Backend läuft bereits.",
      detail: (pid, port) =>
        `Prozess ${pid} belegt bereits Port ${port}. Soll die alte Instanz beendet werden?`,
      replace: "Ersetzen",
      quit: "Beenden",
    },
    startFailed: {
      title: "Encounty konnte nicht gestartet werden",
      detail: (reason) =>
        `Der Start ist fehlgeschlagen, die Anwendung wird beendet.\n\nDetails: ${reason}`,
    },
    menu: { edit: "Bearbeiten", window: "Fenster" },
    about: { credits: "Zähler und Tracker für Shiny-Encounter in Pokémon" },
  },
  en: {
    zombie: {
      message: "An Encounty backend is already running.",
      detail: (pid, port) => `Process ${pid} is holding port ${port}. Stop the old instance?`,
      replace: "Replace",
      quit: "Quit",
    },
    startFailed: {
      title: "Encounty could not start",
      detail: (reason) => `Startup failed, so the app is shutting down.\n\nDetails: ${reason}`,
    },
    menu: { edit: "Edit", window: "Window" },
    about: { credits: "Pokémon Shiny Encounter Counter & Tracker" },
  },
  es: {
    zombie: {
      message: "Ya se está ejecutando un backend de Encounty.",
      detail: (pid, port) =>
        `El proceso ${pid} está ocupando el puerto ${port}. ¿Detener la instancia anterior?`,
      replace: "Reemplazar",
      quit: "Salir",
    },
    startFailed: {
      title: "Encounty no pudo iniciarse",
      detail: (reason) =>
        `El inicio falló, así que la aplicación se cerrará.\n\nDetalles: ${reason}`,
    },
    menu: { edit: "Edición", window: "Ventana" },
    about: { credits: "Contador y registro de encuentros shiny de Pokémon" },
  },
  fr: {
    zombie: {
      message: "Un backend Encounty est déjà en cours d'exécution.",
      detail: (pid, port) =>
        `Le processus ${pid} occupe le port ${port}. Arrêter l'ancienne instance ?`,
      replace: "Remplacer",
      quit: "Quitter",
    },
    startFailed: {
      title: "Encounty n'a pas pu démarrer",
      detail: (reason) =>
        `Le démarrage a échoué, l'application va se fermer.\n\nDétails : ${reason}`,
    },
    menu: { edit: "Édition", window: "Fenêtre" },
    about: { credits: "Compteur et suivi de rencontres shiny Pokémon" },
  },
  ja: {
    zombie: {
      message: "Encountyのバックエンドはすでに実行中です。",
      detail: (pid, port) =>
        `プロセス ${pid} がポート ${port} を使用しています。古いインスタンスを終了しますか？`,
      replace: "置き換える",
      quit: "終了",
    },
    startFailed: {
      title: "Encountyを起動できませんでした",
      detail: (reason) => `起動に失敗したため、アプリを終了します。\n\n詳細: ${reason}`,
    },
    menu: { edit: "編集", window: "ウインドウ" },
    about: { credits: "ポケモンの色違いエンカウントカウンター＆トラッカー" },
  },
};

/**
 * Picks the language for native surfaces from the languages the OS prefers.
 *
 * The UI language the user picked lives in the renderer's localStorage, which
 * the main process cannot read, and some of these strings are needed before any
 * window exists. The system language is the best signal available, and it
 * matches how the OS localizes its own permission prompts and the menu roles.
 * Falls back to German like the renderer's i18n does.
 *
 * Must not run before the app is ready: the locale APIs are unreliable until
 * then.
 */
export function nativeStrings(): NativeStrings {
  for (const tag of app.getPreferredSystemLanguages()) {
    // Electron hands out BCP-47 tags ("en-US"), but on Linux the value is
    // derived from $LANG, which is POSIX style ("en_US.UTF-8"). Split on both
    // so a locale that took the POSIX route is not silently ignored.
    const primary = tag.split(/[-_.]/)[0].toLowerCase();
    if ((NATIVE_LOCALES as readonly string[]).includes(primary)) {
      return NATIVE_STRINGS[primary as NativeLocale];
    }
  }
  return NATIVE_STRINGS.de;
}
