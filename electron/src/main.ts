import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, session, desktopCapturer, ipcMain, shell, systemPreferences, protocol, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import { GoProcessManager } from './process-manager';
import { BACKEND_PORT } from './config';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const isWayland = process.platform === 'linux' &&
  (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');

let mainWindow: BrowserWindow | null = null;
let goProcess: GoProcessManager | null = null;
const isDev = process.argv.includes('--dev');

// Set app name early so macOS menu bar shows "Encounty" instead of "Electron".
app.setName('Encounty');

// Source ID pre-selected by the renderer via capture:select-source IPC.
// Consumed once by setDisplayMediaRequestHandler, then reset to null.
let pendingSourceId: string | null = null;

// --- Hotkey management (macOS) -----------------------------------------------
// On macOS, the Go backend cannot register CGEventTap hotkeys because it runs
// as a child process without Accessibility permission. Instead, Electron
// registers globalShortcuts and relays triggered actions to the Go backend.

/** Maps action names to their currently registered accelerator string. */
let registeredHotkeys: Record<string, string> = {};
let hotkeysPaused = false;

/** Map of special key names to their Electron accelerator equivalents. */
const ELECTRON_KEY_MAP: Record<string, string> = {
  'arrowup': 'Up', 'arrowdown': 'Down', 'arrowleft': 'Left', 'arrowright': 'Right',
  'escape': 'Escape', 'enter': 'Enter', 'backspace': 'Backspace', 'delete': 'Delete',
  'tab': 'Tab', 'space': 'Space', 'home': 'Home', 'end': 'End',
  'pageup': 'PageUp', 'pagedown': 'PageDown',
  'numpadadd': 'numadd', 'numpadsubtract': 'numsub',
  'numpadmultiply': 'nummult', 'numpaddivide': 'numdec',
  'numpadenter': 'Enter', 'numpaddecimal': 'numdec',
  'numpad0': 'num0', 'numpad1': 'num1', 'numpad2': 'num2', 'numpad3': 'num3',
  'numpad4': 'num4', 'numpad5': 'num5', 'numpad6': 'num6', 'numpad7': 'num7',
  'numpad8': 'num8', 'numpad9': 'num9',
  '+': 'Plus', '-': '-', '=': '=', '[': '[', ']': ']',
  ';': ';', "'": "'", ',': ',', '.': '.', '/': '/', '\\': '\\', '`': '`',
};

/**
 * Resolves a single lowercase key name to its Electron accelerator string.
 * Returns null for unrecognized keys.
 */
function resolveElectronKey(lower: string): string | null {
  if (lower === 'ctrl' || lower === 'control') return 'Control';
  if (lower === 'shift') return 'Shift';
  if (lower === 'alt') return 'Alt';

  const mapped = ELECTRON_KEY_MAP[lower];
  if (mapped) return mapped;
  if (lower.startsWith('f') && /^f\d+$/.test(lower)) return lower.toUpperCase();
  if (lower.length === 1) return lower.toUpperCase();
  return null;
}

/**
 * Converts the app's key combo format ("Ctrl+Shift+F1", "a", "+") to Electron's
 * accelerator format ("Control+Shift+F1", "A", "Plus").
 * Returns null if the combo cannot be represented as an Electron accelerator.
 */
function toElectronAccelerator(combo: string): string | null {
  if (!combo) return null;
  if (combo === '+') return 'Plus';

  const parts = combo.split('+');
  const mapped: string[] = [];

  for (const part of parts) {
    const electronKey = resolveElectronKey(part.toLowerCase().trim());
    if (!electronKey) return null;
    mapped.push(electronKey);
  }
  return mapped.join('+');
}

/** Unregisters all current hotkeys and registers new ones from the hotkey map. */
function syncElectronHotkeys(hotkeyMap: Record<string, string>): void {
  if (process.platform !== 'darwin') return;

  for (const accel of Object.values(registeredHotkeys)) {
    try { globalShortcut.unregister(accel); } catch { /* ignore */ }
  }
  registeredHotkeys = {};

  if (hotkeysPaused) return;

  const actionMap: Record<string, string> = {
    increment: 'increment',
    decrement: 'decrement',
    reset: 'reset',
    next_pokemon: 'next',
  };

  for (const [frontendAction, combo] of Object.entries(hotkeyMap)) {
    if (!combo) continue;
    const backendAction = actionMap[frontendAction] ?? frontendAction;
    const accelerator = toElectronAccelerator(combo);
    if (!accelerator) {
      console.warn(`[Hotkeys] Cannot convert "${combo}" to Electron accelerator`);
      continue;
    }

    try {
      const action = backendAction;
      globalShortcut.register(accelerator, () => {
        net.fetch(`http://localhost:${BACKEND_PORT}/api/hotkeys/trigger/${action}`, {
          method: 'POST',
        }).catch((err: unknown) => {
          console.error(`[Hotkeys] Failed to trigger ${action}:`, err);
        });
      });
      registeredHotkeys[frontendAction] = accelerator;
      console.log(`[Hotkeys] Registered: ${frontendAction} → ${accelerator} → ${action}`);
    } catch (err) {
      console.warn(`[Hotkeys] Failed to register "${accelerator}":`, err);
    }
  }
}

ipcMain.handle('hotkeys:sync', (_e: Electron.IpcMainInvokeEvent, hotkeyMap: Record<string, string>) => {
  syncElectronHotkeys(hotkeyMap);
});

ipcMain.handle('hotkeys:pause', () => {
  hotkeysPaused = true;
  for (const accel of Object.values(registeredHotkeys)) {
    try { globalShortcut.unregister(accel); } catch { /* ignore */ }
  }
});

ipcMain.handle('hotkeys:resume', () => {
  hotkeysPaused = false;
  net.fetch(`http://localhost:${BACKEND_PORT}/api/state`)
    .then(r => r.json())
    .then((state: any) => {
      if (state?.hotkeys) {
        syncElectronHotkeys(state.hotkeys);
      }
    })
    .catch((err: unknown) => console.error('[Hotkeys] Failed to re-sync after resume:', err));
});

// --- Window bounds persistence ------------------------------------------------

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

const boundsFile = path.join(app.getPath('userData'), 'window-bounds.json');

function loadBounds(): WindowBounds {
  try {
    const raw = fs.readFileSync(boundsFile, 'utf-8');
    return JSON.parse(raw) as WindowBounds;
  } catch {
    return { width: 1280, height: 720 };
  }
}

function saveBounds(): void {
  if (!mainWindow) return;
  const maximized = mainWindow.isMaximized();
  // Store the restored (non-maximized) bounds so the window doesn't
  // permanently stick to full-screen dimensions after a restart.
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const data: WindowBounds = { ...bounds, maximized };
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(data));
  } catch { /* ignore write errors */ }
}

// --- Window creation -----------------------------------------------------------

/** Registers event handlers for bounds persistence, external link handling, and cleanup. */
function setupWindowEvents(win: BrowserWindow, saved: WindowBounds): void {
  // Forward maximize/unmaximize state to the renderer
  win.on('maximize', () => {
    win.webContents.send('window:maximized-change', true);
  });
  win.on('unmaximize', () => {
    win.webContents.send('window:maximized-change', false);
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
  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);

  // Open external links and overlay URLs in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('encounty://')) return;
    if (url.startsWith('http://localhost:')) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.on('closed', () => {
    mainWindow = null;
  });
}

/** Loads the initial URL and optionally opens DevTools for development. */
async function loadContent(win: BrowserWindow): Promise<void> {
  // In dev mode, load from Vite dev server (frontend + API proxy).
  // Retry until Vite is ready since the background task may still be starting.
  // In production, load from the custom encounty:// protocol.
  if (isDev) {
    const viteUrl = 'http://localhost:5173';
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await win.loadURL(viteUrl);
        break;
      } catch {
        if (i === maxRetries - 1) {
          console.error('[Electron] Vite dev server not reachable after retries');
          app.quit();
          return;
        }
        console.log(`[Electron] Waiting for Vite dev server... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } else {
    await win.loadURL('encounty://app/');
  }

  if (isDev) {
    win.webContents.openDevTools();
  }

  // Allow toggling DevTools in production builds via F12 / Ctrl+Shift+I
  // (or Cmd+Opt+I on macOS). The default application menu — which would
  // normally provide these shortcuts — is removed for a cleaner UI, so we
  // bind them explicitly here. Without this, diagnosing prod-only renderer
  // issues (e.g. CSP violations, asset 404s) requires a custom dev build.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    const isF12 = input.key === 'F12';
    const isInspectShortcut =
      (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
    if (isF12 || isInspectShortcut) {
      win.webContents.toggleDevTools();
    }
  });
}

async function createWindow(): Promise<void> {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.join(__dirname, '..', '..', 'frontend', 'public', 'app-icon.png');

  const saved = loadBounds();

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    title: 'Encounty',
    icon: iconPath,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 17 } }
      : { frame: false }),
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  setupWindowEvents(mainWindow, saved);
  await loadContent(mainWindow);
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

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Encounty',
    message: 'Ein Encounty-Backend läuft bereits.',
    detail: `Prozess ${zombiePid} belegt bereits Port ${port}. Soll die alte Instanz beendet werden?`,
    buttons: ['Ersetzen', 'Beenden'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response !== 0) {
    app.quit();
    return false;
  }

  await GoProcessManager.killProcess(zombiePid);
  // Wait briefly for port to be released
  await new Promise(r => setTimeout(r, 1000));
  return true;
}

/** Configures electron-updater event listeners and triggers an initial update check. */
function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:downloaded');
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', err.message);
  });

  // Check for updates 5 seconds after window creation
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Electron] Update check failed:', err);
    });
  }, 5000);
}

async function startApp(): Promise<void> {
  try {
    // In dev mode, Go backend runs separately (via `make dev` / `go run`).
    // In production, spawn the bundled Go binary.
    if (!isDev) {
      goProcess = new GoProcessManager();

      const canProceed = await resolveZombieBackend(goProcess, BACKEND_PORT);
      if (!canProceed) return;

      // Wait for backend to be ready
      const proc = goProcess;
      if (!proc) throw new Error('Go process not initialized');
      await new Promise<void>((resolve, reject) => {
        proc.on('ready', () => {
          console.log('[Electron] Go backend ready');
          resolve();
        });

        proc.on('error', (err) => {
          console.error('[Electron] Go backend error:', err);
          reject(err);
        });

        proc.on('max-restarts-reached', () => {
          reject(new Error('Go backend failed to start after multiple attempts'));
        });

        proc.start();
      });
    }

    // Create window once backend is ready
    await createWindow();

    // Fetch the real build version from the Go backend and update the About panel.
    if (process.platform === 'darwin') {
      try {
        const res = await net.fetch(`http://localhost:${BACKEND_PORT}/api/version`);
        const data = await res.json() as { display?: string };
        if (data.display) {
          app.setAboutPanelOptions({ applicationVersion: data.display });
        }
      } catch { /* non-critical — About panel keeps empty version */ }
    }

    // Auto-updater: skip in dev mode (app.version is not valid semver)
    if (!isDev) {
      setupAutoUpdater();
    }

  } catch (err) {
    console.error('[Electron] Failed to start app:', err);
    app.quit();
  }
}

// IPC handlers for frameless window controls
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', async () => {
  await goProcess?.stop();
  mainWindow?.close();
});

ipcMain.handle('window:focus', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// --- Detector performance metrics (dev-only modal in renderer) -------------
// Returns per-process CPU/memory snapshots from Chromium's task-manager
// telemetry. Numbers follow the top(1) convention: 100 % = 1 saturated core.
// Cheap to call (a few hundred microseconds) and safe to poll once per second.

type ProcessSample = {
  pid: number;
  cpuPct: number;
  memMB: number;
  wakeups?: number;
};
type ProcessStats = {
  renderer: ProcessSample | null;
  gpu: ProcessSample | null;
  browser: ProcessSample | null;
  utility: Array<ProcessSample & { name?: string }>;
  totalCpuPct: number;
  cpuCores: number;
  totalMemMB: number;
};

ipcMain.handle('metrics:get-process-stats', (): ProcessStats => {
  const metrics = app.getAppMetrics();
  const rendererPid = mainWindow?.webContents.getOSProcessId();
  const toSample = (m: Electron.ProcessMetric): ProcessSample => ({
    pid: m.pid,
    cpuPct: m.cpu.percentCPUUsage,
    memMB: m.memory.workingSetSize / 1024,
    wakeups: m.cpu.idleWakeupsPerSecond,
  });
  const renderer = metrics.find((m) => m.pid === rendererPid) ?? null;
  const gpu = metrics.find((m) => m.type === 'GPU') ?? null;
  const browser = metrics.find((m) => m.type === 'Browser') ?? null;
  const utility = metrics
    .filter((m) => m.type === 'Utility')
    .map((m) => ({ ...toSample(m), name: m.name }));
  return {
    renderer: renderer ? toSample(renderer) : null,
    gpu: gpu ? toSample(gpu) : null,
    browser: browser ? toSample(browser) : null,
    utility,
    totalCpuPct: metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
    totalMemMB: metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024,
    cpuCores: os.cpus().length,
  };
});

ipcMain.handle('metrics:get-gpu-info', async () => {
  try {
    return await app.getGPUInfo('complete');
  } catch (err) {
    console.error('[Electron] getGPUInfo failed:', err);
    return null;
  }
});

ipcMain.handle('dialog:open-folder', async (_event, title?: string) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: title ?? 'Select folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('update:check', async () => {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('[Electron] Update check failed:', err);
  }
});

ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    console.error('[Electron] Update download failed:', err);
  }
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall(false, true);
});

// Capture source enumeration — returns screens and windows with thumbnails
// Also caches the raw DesktopCapturerSource objects for reuse in the display
// media handler, avoiding a second getSources() call whose IDs may not resolve
// correctly in Electron ≥41.1 (OverconstrainedError on deviceId).
let cachedCaptureSources: Electron.DesktopCapturerSource[] = [];

ipcMain.handle('capture:get-sources', async () => {
  if (isWayland) {
    console.log('[Electron] capture:get-sources skipped on Wayland');
    return [];
  }
  // On macOS, check screen recording permission and log status for debugging.
  // desktopCapturer.getSources() silently returns empty results when denied.
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    console.log('[Electron] macOS screen recording status:', status);
    if (status !== 'granted') {
      console.warn('[Electron] Screen recording not granted — sources will be empty. Grant permission in System Settings > Privacy > Screen Recording.');
    }
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });
  cachedCaptureSources = sources;
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    display_id: s.display_id,
    appIcon: s.appIcon?.toDataURL() ?? null,
  }));
});

// Pre-select a source ID so the next getDisplayMedia call uses it
ipcMain.handle('capture:select-source', (_e: Electron.IpcMainInvokeEvent, sourceId: string) => {
  console.log('[Electron] capture:select-source called with:', sourceId);
  pendingSourceId = sourceId;
});

// macOS permission status — checks Accessibility and Screen Recording from the Electron process
ipcMain.handle('permissions:get-status', () => {
  if (process.platform !== 'darwin') {
    return { accessibility: true, screen_recording: true };
  }
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screen_recording: systemPreferences.getMediaAccessStatus('screen') === 'granted',
  };
});

// macOS permission request — opens System Settings or triggers native dialog
ipcMain.handle('permissions:request', (_e: Electron.IpcMainInvokeEvent, permission: string) => {
  if (process.platform !== 'darwin') return;
  if (permission === 'accessibility') {
    systemPreferences.isTrustedAccessibilityClient(true);
  } else if (permission === 'screen_recording') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
});

// Request camera access — uses systemPreferences on macOS, no-op elsewhere
ipcMain.handle('camera:request-access', async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    return systemPreferences.askForMediaAccess('camera');
  }
  return true;
});

// Single-instance lock — prevent multiple app windows
const gotTheLock = app.requestSingleInstanceLock();
if (gotTheLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
} else {
  app.quit();
}

// Prevent Chromium from throttling timers when the window is minimized,
// so the screen capture detection loop keeps running at full speed.
app.commandLine.appendSwitch('disable-background-timer-throttling');

// WebGPU: override GPU blocklist so NVIDIA works on Linux
app.commandLine.appendSwitch('disable-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-webgpu');

// Wayland-specific Chromium flags
if (isWayland) {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'PipeWireV4L2Camera,WebRTCPipeWireCapturer,WaylandWindowDecorations');
  app.commandLine.appendSwitch('enable-wayland-ime');
}

console.log('[Electron] Platform detection:', { isWayland, platform: process.platform, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE });

// Register encounty:// as a privileged scheme so the renderer can use
// relative URLs, fetch(), and service workers just like HTTPS.
// Must be called before app.on('ready').
protocol.registerSchemesAsPrivileged([{
  scheme: 'encounty',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
  }
}]);

// Move Electron/Chromium data into a subdirectory so it doesn't mix with
// the Go backend's config files (state.json etc.) in the same folder.
app.setPath('userData', path.join(app.getPath('userData'), 'electron'));

// App lifecycle
app.on('ready', async () => {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.join(__dirname, '..', '..', 'frontend', 'public', 'app-icon.png');

  // Configure the macOS Dock icon using the ICNS file for proper macOS styling.
  if (process.platform === 'darwin') {
    const icnsPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.icns')
      : path.join(__dirname, '..', 'build', 'icon.icns');
    const dockIcon = nativeImage.createFromPath(icnsPath);
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }

    // Set initial About panel — version is updated after the backend reports it.
    const aboutIcon = nativeImage.createFromPath(iconPath);
    app.setAboutPanelOptions({
      applicationName: 'Encounty',
      applicationVersion: '',
      copyright: '© 2026 ZSleyer',
      credits: 'Pokémon Shiny Encounter Counter & Tracker',
      ...(aboutIcon.isEmpty() ? {} : { iconPath }),
    });
  }

  // Resolve the frontend dist directory and register the encounty:// protocol
  // handler to serve frontend assets from disk.
  const frontendRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'frontend-dist')
    : path.join(__dirname, '..', '..', 'frontend', 'dist');

  protocol.handle('encounty', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (filePath === '/' || filePath === '') filePath = '/index.html';

    const fullPath = path.join(frontendRoot, filePath);

    // SPA fallback: serve index.html for routes that don't map to files
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return net.fetch('file://' + path.join(frontendRoot, 'index.html'));
      }
      return net.fetch('file://' + fullPath);
    } catch {
      return net.fetch('file://' + path.join(frontendRoot, 'index.html'));
    }
  });

  // On macOS, setting the menu to null still shows the default Electron menu.
  // Build a minimal app menu with standard keyboard shortcuts instead.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ],
      },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  // Set a strict Content-Security-Policy in production to suppress the
  // Electron CSP warning and harden the renderer against injection attacks.
  // In dev mode the Vite dev server requires more permissive settings.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            [
              "default-src 'self' encounty:",
              "script-src 'self' encounty:",
              "style-src 'self' 'unsafe-inline' encounty: https://fonts.googleapis.com",
              "img-src 'self' encounty: data: blob: http://localhost:* https:",
              "connect-src 'self' encounty: http://localhost:* ws://localhost:* https://pokeapi.co https://*.pokemon.com https://fonts.googleapis.com",
              "media-src 'self' blob: mediastream:",
              "worker-src 'self' blob: encounty:",
              "font-src 'self' encounty: data: https://fonts.gstatic.com",
            ].join('; '),
          ],
        },
      });
    });
  }

  // Allow media, display-capture, and WebGPU permissions
  const allowedPermissions = new Set(['media', 'display-capture', 'webgpu', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    console.log('[Electron] Permission request:', permission);
    callback(allowedPermissions.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    console.log('[Electron] Permission check:', permission);
    return allowedPermissions.has(permission as string);
  });

  // Auto-grant camera device permissions so re-selecting the same camera
  // doesn't trigger repeated permission prompts.
  session.defaultSession.setDevicePermissionHandler((details) => {
    if ((details.deviceType as string) === 'videoinput') return true;
    return false;
  });

  // Electron REQUIRES setDisplayMediaRequestHandler — without it getDisplayMedia()
  // is always denied ("Not supported"). On Wayland, desktopCapturer.getSources()
  // triggers the PipeWire portal once per call, which is fine here (only called
  // when the user actually clicks Connect). The repeated thumbnail polling
  // (capture:get-sources IPC) is already guarded to skip on Wayland.
  // Uses cachedCaptureSources from the SourcePickerModal's thumbnail fetch to
  // avoid a second getSources() call that may produce stale/invalid source IDs
  // in Electron ≥41.1. Falls back to a fresh query if cache is empty.
  const displayMediaHandler: Parameters<typeof session.defaultSession.setDisplayMediaRequestHandler>[0] = (_request, callback) => {
    void (async () => {
    console.log('[Electron] setDisplayMediaRequestHandler invoked, isWayland:', isWayland, 'pendingSourceId:', pendingSourceId, 'cached:', cachedCaptureSources.length);
    try {
      // Prefer cached sources from the SourcePickerModal's thumbnail fetch —
      // the same objects that Chromium's device enumeration already knows about.
      const sources = cachedCaptureSources.length > 0
        ? cachedCaptureSources
        : await desktopCapturer.getSources({ types: ['screen', 'window'] });
      console.log('[Electron] Using', sources.length, 'sources (cached:', cachedCaptureSources.length > 0, ')');

      if (!sources.length) {
        // @ts-expect-error -- calling with no args denies the request
        callback();
        return;
      }

      if (pendingSourceId) {
        const selected = sources.find(s => s.id === pendingSourceId);
        pendingSourceId = null;
        const picked = selected ?? sources[0];
        console.log('[Electron] Picking source:', picked.id, picked.name);
        callback({ video: picked });
      } else {
        console.log('[Electron] Picking first source:', sources[0].id, sources[0].name);
        callback({ video: sources[0] });
      }
    } catch (err) {
      pendingSourceId = null;
      console.log('[Electron] Display media request failed:', err);
      // @ts-expect-error -- calling with no args denies the request
      callback();
    }
    })();
  };

  session.defaultSession.setDisplayMediaRequestHandler(displayMediaHandler);

  // Allow the renderer to dynamically switch to the macOS system picker
  // as a fallback when the custom handler produces OverconstrainedError.
  ipcMain.handle('capture:set-system-picker', (_e: Electron.IpcMainInvokeEvent, enabled: boolean) => {
    console.log('[Electron] capture:set-system-picker:', enabled);
    session.defaultSession.setDisplayMediaRequestHandler(
      displayMediaHandler,
      { useSystemPicker: enabled },
    );
  });

  await startApp();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  console.log('[Electron] Shutting down...');
  globalShortcut.unregisterAll();
  await goProcess?.stop();
});

// Handle crashes gracefully
process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Electron] Unhandled rejection:', reason);
});
