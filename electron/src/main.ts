/**
 * main.ts is the Electron entry point: it owns the app lifecycle, the browser
 * window and the IPC handlers that act on the window or the updater.
 *
 * The remaining concerns live in siblings: hotkeys, window state and zoom,
 * capture, metrics, native strings and the post-ready setup steps.
 */

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  systemPreferences,
  protocol,
} from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import fs from "node:fs";
import { GoProcessManager } from "./process-manager";
import { BACKEND_PORT, isDev, isWayland } from "./config";
import {
  apiBaseUrlFor,
  fetchBackendVersion,
  pinBackendCertificate,
  repinBackendCertificate,
} from "./tls";
import { log } from "./logger";
import { getMainWindow, setMainWindow } from "./main-window";
import { nativeStrings } from "./native-strings";
import {
  initWindowState,
  loadBounds,
  saveBounds,
  setupZoomShortcuts,
  getZoom,
  setZoom,
  type WindowBounds,
} from "./window-state";
import { setupDisplayMedia } from "./capture";
import {
  setupApplicationMenu,
  setupContentSecurityPolicy,
  setupDockAndAboutPanel,
  setupPermissionHandlers,
  setupProtocolHandler,
} from "./app-ready";
// Imported for their side effect: both modules register their IPC handlers at
// import time and export nothing main.ts calls.
import "./hotkeys";
import "./metrics";

let goProcess: GoProcessManager | null = null;

/**
 * Reports whether the running AppImage can be overwritten in place, which is how
 * electron-updater applies Linux updates. Distribution packages (AUR) install it
 * root-owned under /opt, where an update would either fail or desync the file
 * from the package manager's database.
 */
function canReplaceOwnAppImage(): boolean {
  const appImage = process.env.APPIMAGE;
  if (!appImage) return false;
  try {
    fs.accessSync(path.dirname(appImage), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hands url to the operating system's default handler, but only for web URLs.
 * shell.openExternal() launches whatever application has registered the scheme,
 * so an unvalidated URL turns any injected link into a local program launch
 * (smb:, ms-msdt:, file: and friends). Everything the app links to is http(s).
 */
function openExternalIfAllowed(url: string): void {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return;
  }
  if (scheme !== "https:" && scheme !== "http:") {
    log.warn("Refused to open external URL with scheme", scheme);
    return;
  }
  shell.openExternal(url);
}

// In-app auto-update capability: Linux only for a self-updatable AppImage,
// Windows only for the installed (NSIS) build. Portable Windows sets
// PORTABLE_EXECUTABLE_DIR and has no install target; macOS is unsigned so
// Squirrel.Mac refuses updates. Both flags reach the renderer through
// additionalArguments below, because the sandboxed preload cannot use fs.
// isDev keeps the dev run on the same renderer code path as a normal AppImage,
// where no APPIMAGE variable exists.
const autoUpdateSupported =
  process.platform === "linux"
    ? isDev || canReplaceOwnAppImage()
    : process.platform === "win32" && !process.env.PORTABLE_EXECUTABLE_DIR;

// A read-only AppImage means someone else owns the install, so the update
// belongs to that package manager and the UI says so instead of offering a
// download.
const packageManagedInstall =
  process.platform === "linux" && !!process.env.APPIMAGE && !autoUpdateSupported;

// Set app name early so macOS menu bar shows "Encounty" instead of "Electron".
app.setName("Encounty");

// Straight after setName and before userData is re-pointed below, which is the
// only window in which the bounds path resolves to what it always has.
initWindowState();

// --- Window creation -----------------------------------------------------------

/** Registers event handlers for bounds persistence, external link handling, and cleanup. */
function setupWindowEvents(win: BrowserWindow, saved: WindowBounds): void {
  // Forward maximize/unmaximize state to the renderer
  win.on("maximize", () => {
    win.webContents.send("window:maximized-change", true);
  });
  win.on("unmaximize", () => {
    win.webContents.send("window:maximized-change", false);
  });

  // Restore maximized state if it was saved
  if (saved.maximized) {
    win.maximize();
  }

  // Persist window bounds on resize/move (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 500);
  };
  win.on("resize", debouncedSave);
  win.on("move", debouncedSave);

  // Open external links and overlay URLs in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("encounty://")) return;
    if (url.startsWith("http://localhost:")) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  });

  win.on("closed", () => {
    setMainWindow(null);
  });
}

/** Loads the initial URL and optionally opens DevTools for development. */
async function loadContent(win: BrowserWindow): Promise<void> {
  // In dev mode, load from Vite dev server (frontend + API proxy).
  // Retry until Vite is ready since the background task may still be starting.
  // In production, load from the custom encounty:// protocol.
  if (isDev) {
    const viteUrl = "http://localhost:5173";
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await win.loadURL(viteUrl);
        break;
      } catch {
        if (i === maxRetries - 1) {
          log.error("Vite dev server not reachable after retries");
          app.quit();
          return;
        }
        log.info(`Waiting for Vite dev server... (${i + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } else {
    await win.loadURL("encounty://app/");
  }

  if (isDev) {
    win.webContents.openDevTools();
  }

  // Allow toggling DevTools in production builds via F12 / Ctrl+Shift+I
  // (or Cmd+Opt+I on macOS). The default application menu, which would
  // normally provide these shortcuts, is removed for a cleaner UI, so we
  // bind them explicitly here. Without this, diagnosing prod-only renderer
  // issues (e.g. CSP violations, asset 404s) requires a custom dev build.
  win.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const isF12 = input.key === "F12";
    const isInspectShortcut =
      (input.control || input.meta) && input.shift && input.key.toLowerCase() === "i";
    if (isF12 || isInspectShortcut) {
      win.webContents.toggleDevTools();
    }
  });
}

/**
 * Creates the application window.
 *
 * `apiBaseUrl` is the origin the renderer talks to. It is handed over as a
 * launch argument because the preload is sandboxed: it can neither import
 * config.ts nor await the backend's /api/version to work the base out itself.
 */
async function createWindow(apiBaseUrl: string): Promise<void> {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "app-icon.png")
    : path.join(__dirname, "..", "..", "frontend", "public", "app-icon.png");

  const saved = loadBounds();

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    title: "Encounty",
    icon: iconPath,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 17 } }
      : { frame: false }),
    backgroundColor: "#0f0f13",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [
        `--auto-update=${autoUpdateSupported ? "1" : "0"}`,
        `--package-managed=${packageManagedInstall ? "1" : "0"}`,
        `--api-base=${apiBaseUrl}`,
      ],
    },
  });
  setMainWindow(win);

  setupWindowEvents(win, saved);
  setupZoomShortcuts(win, saved);
  await loadContent(win);
}

/**
 * Resolves a zombie backend process occupying the backend port.
 * Prompts the user to kill the stale process or quit the app.
 * Returns false if the user chose to quit (caller should return early).
 */
async function resolveZombieBackend(proc: GoProcessManager, port: number): Promise<boolean> {
  const portInUse = await GoProcessManager.checkPort(port);
  if (!portInUse) return true;

  const stalePid = proc.readStalePid();
  const zombiePid = stalePid || GoProcessManager.findProcessOnPort(port);
  if (!zombiePid) return true;

  const strings = nativeStrings().zombie;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Encounty",
    message: strings.message,
    detail: strings.detail(zombiePid, port),
    buttons: [strings.replace, strings.quit],
    defaultId: 0,
    cancelId: 1,
  });

  if (response !== 0) {
    app.quit();
    return false;
  }

  await GoProcessManager.killProcess(zombiePid);
  // Wait briefly for port to be released
  await new Promise((r) => setTimeout(r, 1000));
  return true;
}

/** Configures electron-updater event listeners and triggers an initial update check. */
function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    getMainWindow()?.webContents.send("update:available", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    getMainWindow()?.webContents.send("update:progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", () => {
    getMainWindow()?.webContents.send("update:downloaded");
  });

  autoUpdater.on("error", (err) => {
    getMainWindow()?.webContents.send("update:error", err.message);
  });

  // Check for updates 5 seconds after window creation
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error("Update check failed:", err);
    });
  }, 5000);
}

async function startApp(): Promise<void> {
  try {
    // In dev mode, Go backend runs separately (via `make dev` / `go run`).
    // In production, spawn the bundled Go binary.
    if (!isDev) {
      goProcess = new GoProcessManager(autoUpdateSupported);

      const canProceed = await resolveZombieBackend(goProcess, BACKEND_PORT);
      if (!canProceed) return;

      // Wait for backend to be ready
      const proc = goProcess;
      if (!proc) throw new Error("Go process not initialized");
      await new Promise<void>((resolve, reject) => {
        proc.on("ready", () => {
          log.info("Go backend ready");
          resolve();
        });

        proc.on("error", (err) => {
          log.error("Go backend error:", err);
          reject(err);
        });

        proc.on("max-restarts-reached", () => {
          reject(new Error("Go backend failed to start after multiple attempts"));
        });

        proc.start();
      });
    }

    // Ask the backend where it listens before the window exists: the pinned
    // certificate has to be installed before the renderer issues its first
    // request, and the resolved base travels to the preload as a launch
    // argument. A backend without TLS leaves everything on plain HTTP.
    const version = await fetchBackendVersion();
    if (version?.tls) {
      pinBackendCertificate(version.tls.fingerprint);
      log.info(`Backend TLS pinned on port ${version.tls.port}`);

      // The backend can come back without the app restarting: it re-execs on
      // /api/restart, and the process manager respawns it after a crash.
      // Normally it reuses the certificate from disk and the pin still
      // matches, but if that pair was lost or corrupted it issues a new one.
      // A pin taken once at startup would then reject the backend for the
      // rest of the session, which looks like the backend disappearing.
      goProcess?.on("ready", () => {
        void repinBackendCertificate().then((changed) => {
          if (changed) log.warn("Backend reissued its certificate, pin refreshed");
        });
      });
    }

    // Create window once backend is ready
    await createWindow(apiBaseUrlFor(version?.tls ?? null));

    // The same response carries the real build version for the About panel.
    if (process.platform === "darwin" && version?.display) {
      app.setAboutPanelOptions({ applicationVersion: version.display });
    }

    // Auto-updater: skip in dev mode (app.version is not valid semver) and on
    // builds that cannot self-update (portable Windows, unsigned macOS), where
    // electron-updater would only error.
    if (!isDev && autoUpdateSupported) {
      setupAutoUpdater();
    }
  } catch (err) {
    log.error("Failed to start app:", err);
    // Without this the app would vanish without a word: the failure happens
    // before any window exists, so there is no renderer left to report it.
    // showErrorBox is synchronous and needs no window, which is what the quit
    // right after it requires.
    const strings = nativeStrings().startFailed;
    const reason = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(strings.title, strings.detail(reason));
    app.quit();
  }
}

// IPC handlers for frameless window controls
ipcMain.handle("window:minimize", () => {
  getMainWindow()?.minimize();
});

ipcMain.handle("window:maximize", () => {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.handle("window:close", async () => {
  await goProcess?.stop();
  getMainWindow()?.close();
});

ipcMain.handle("window:focus", () => {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

ipcMain.handle("window:get-zoom", () => getZoom());

ipcMain.handle("window:set-zoom", (_event, factor: number) => setZoom(factor));

ipcMain.handle("dialog:open-folder", async (_event, title?: string) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: title ?? "Select folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("update:check", async () => {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log.error("Update check failed:", err);
  }
});

ipcMain.handle("update:download", async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log.error("Update download failed:", err);
  }
});

ipcMain.handle("update:install", () => {
  autoUpdater.quitAndInstall(false, true);
});

// macOS permission status: checks Accessibility and Screen Recording from the Electron process
ipcMain.handle("permissions:get-status", () => {
  if (process.platform !== "darwin") {
    return { accessibility: true, screen_recording: true };
  }
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screen_recording: systemPreferences.getMediaAccessStatus("screen") === "granted",
  };
});

// macOS permission request: opens System Settings or triggers native dialog
ipcMain.handle("permissions:request", (_e: Electron.IpcMainInvokeEvent, permission: string) => {
  if (process.platform !== "darwin") return;
  if (permission === "accessibility") {
    systemPreferences.isTrustedAccessibilityClient(true);
  } else if (permission === "screen_recording") {
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  }
});

// Request camera access: uses systemPreferences on macOS, no-op elsewhere
ipcMain.handle("camera:request-access", async (): Promise<boolean> => {
  if (process.platform === "darwin") {
    return systemPreferences.askForMediaAccess("camera");
  }
  return true;
});

// Single-instance lock prevents multiple app windows
const gotTheLock = app.requestSingleInstanceLock();
if (gotTheLock) {
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
} else {
  app.quit();
}

// Prevent Chromium from throttling timers when the window is minimized,
// so the screen capture detection loop keeps running at full speed.
app.commandLine.appendSwitch("disable-background-timer-throttling");

// Prevent Chromium from registering as a media session handler. Without this,
// Chromium intercepts system-wide media keys (volume, play/pause) on Windows,
// causing the OS volume OSD to appear and potentially degrading shell responsiveness.
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");

// WebGPU: the detection engine has no CPU fallback worth shipping, so keep it
// running on drivers Chromium would otherwise refuse. ignore-gpu-blocklist covers
// GPUs on the blocklist, enable-unsafe-webgpu covers configurations WebGPU itself
// still considers unsupported. The switch is called "ignore", not "disable";
// Chromium drops unknown switches without a word, so a typo here disables nothing
// and reports nothing.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");

// Wayland-specific Chromium flags. PipeWire screen capture and server-side window
// decorations are built in since Chromium 150, the feature flags that used to gate
// them are gone.
if (isWayland) {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("enable-wayland-ime");
}

log.info("Platform detection:", {
  isWayland,
  platform: process.platform,
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
  XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE,
});

// Register encounty:// as a privileged scheme so the renderer can use
// relative URLs, fetch(), and service workers just like HTTPS.
// Must be called before app.on('ready').
protocol.registerSchemesAsPrivileged([
  {
    scheme: "encounty",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
    },
  },
]);

// Move Electron/Chromium data into a subdirectory so it doesn't mix with
// the Go backend's config files (state.json etc.) in the same folder.
app.setPath("userData", path.join(app.getPath("userData"), "electron"));

// App lifecycle
app.on("ready", async () => {
  setupDockAndAboutPanel();
  setupProtocolHandler();
  setupApplicationMenu();
  setupContentSecurityPolicy();
  setupPermissionHandlers();
  setupDisplayMedia();

  await startApp();
});

app.on("window-all-closed", () => {
  app.quit();
});

// Electron does not await async listeners, so quitting has to be deferred by
// hand: without this the app exits while the backend is still saving state and
// checkpointing its database, and the next start recovers from a write-ahead
// log instead of a clean file.
let quitPending = false;
app.on("before-quit", (event) => {
  if (quitPending) return;
  quitPending = true;
  event.preventDefault();

  log.info("Shutting down...");
  globalShortcut.unregisterAll();
  void Promise.resolve(goProcess?.stop())
    .catch((err) => log.error("Backend shutdown failed:", err))
    .finally(() => app.quit());
});

// Handle crashes gracefully
process.on("uncaughtException", (err) => {
  log.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
});
