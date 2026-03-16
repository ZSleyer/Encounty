import { app, BrowserWindow, Menu, session, desktopCapturer, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { GoProcessManager } from './process-manager';
import path from 'path';
import fs from 'fs';

const isWayland = process.platform === 'linux' &&
  (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');

let mainWindow: BrowserWindow | null = null;
let goProcess: GoProcessManager | null = null;
const isDev = process.argv.includes('--dev');

// Source ID pre-selected by the renderer via capture:select-source IPC.
// Consumed once by setDisplayMediaRequestHandler, then reset to null.
let pendingSourceId: string | null = null;

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
  const bounds = maximized ? (mainWindow as BrowserWindow).getNormalBounds() : mainWindow.getBounds();
  const data: WindowBounds = { ...bounds, maximized };
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(data));
  } catch { /* ignore write errors */ }
}

// --- Window creation -----------------------------------------------------------

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
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Forward maximize/unmaximize state to the renderer
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-change', false);
  });

  // Restore maximized state if it was saved
  if (saved.maximized) {
    mainWindow.maximize();
  }

  // Persist window bounds on resize/move (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 500);
  };
  mainWindow.on('resize', debouncedSave);
  mainWindow.on('move', debouncedSave);

  // Open external links and overlay URLs in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow in-app navigation to the Go backend
    if (url.startsWith('http://localhost:8080')) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // Load from Go backend
  await mainWindow.loadURL('http://localhost:8080');

  // Open DevTools in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startApp(): Promise<void> {
  try {
    // Start Go backend
    goProcess = new GoProcessManager();

    // Wait for backend to be ready
    await new Promise<void>((resolve, reject) => {
      goProcess!.on('ready', () => {
        console.log('[Electron] Go backend ready');
        resolve();
      });

      goProcess!.on('error', (err) => {
        console.error('[Electron] Go backend error:', err);
        reject(err);
      });

      goProcess!.on('max-restarts-reached', () => {
        reject(new Error('Go backend failed to start after multiple attempts'));
      });

      goProcess!.start();
    });

    // Create window once backend is ready
    await createWindow();

    // --- Auto-updater (electron-updater) ---
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
ipcMain.handle('capture:get-sources', async () => {
  if (isWayland) {
    console.log('[Electron] capture:get-sources skipped on Wayland');
    return [];
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });
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

// Single-instance lock — prevent multiple app windows
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Prevent Chromium from throttling timers when the window is minimized,
// so the screen capture detection loop keeps running at full speed.
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Wayland-specific Chromium flags
if (isWayland) {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'PipeWireV4L2Camera,WebRTCPipeWireCapturer,WaylandWindowDecorations');
  app.commandLine.appendSwitch('enable-wayland-ime');
}

console.log('[Electron] Platform detection:', { isWayland, platform: process.platform, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE });

// App lifecycle
app.on('ready', async () => {
  Menu.setApplicationMenu(null);

  // Allow media (camera/mic) and display-capture permissions
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    console.log('[Electron] Permission request:', permission);
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
      return;
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    console.log('[Electron] Permission check:', permission);
    if (permission === 'media' || (permission as string) === 'display-capture') return true;
    return false;
  });

  // Electron REQUIRES setDisplayMediaRequestHandler — without it getDisplayMedia()
  // is always denied ("Not supported"). On Wayland, desktopCapturer.getSources()
  // triggers the PipeWire portal once per call, which is fine here (only called
  // when the user actually clicks Connect). The repeated thumbnail polling
  // (capture:get-sources IPC) is already guarded to skip on Wayland.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    console.log('[Electron] setDisplayMediaRequestHandler invoked, isWayland:', isWayland, 'pendingSourceId:', pendingSourceId);
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      console.log('[Electron] desktopCapturer returned', sources.length, 'sources');
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
        // On Wayland this is the portal-selected source; on X11 it's the first screen
        console.log('[Electron] Picking first source:', sources[0].id, sources[0].name);
        callback({ video: sources[0] });
      }
    } catch (err) {
      pendingSourceId = null;
      console.log('[Electron] Display media request failed:', err);
      // Portal cancelled or no sources — deny gracefully
      // @ts-expect-error -- calling with no args denies the request
      callback();
    }
  });

  await startApp();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  console.log('[Electron] Shutting down...');
  await goProcess?.stop();
});

// Handle crashes gracefully
process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Electron] Unhandled rejection:', reason);
});
