import { app, BrowserWindow } from 'electron';
import { GoProcessManager } from './process-manager';

let mainWindow: BrowserWindow | null = null;
let goProcess: GoProcessManager | null = null;
const isDev = process.argv.includes('--dev');

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'Encounty',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
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

  } catch (err) {
    console.error('[Electron] Failed to start app:', err);
    app.quit();
  }
}

// App lifecycle
app.on('ready', async () => {
  await startApp();
});

app.on('window-all-closed', () => {
  // On macOS, keep app running when windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  // On macOS, recreate window when dock icon is clicked
  if (mainWindow === null) {
    await createWindow();
  }
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
