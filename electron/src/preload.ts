/**
 * preload.ts — Electron preload script.
 *
 * Exposes a safe, minimal API to the renderer via contextBridge so the
 * frontend can control the frameless window (minimize, maximize, close)
 * without having direct access to Node or Electron internals.
 */
import { contextBridge, ipcRenderer } from 'electron';

// Inlined here because sandboxed preloads cannot require() local files —
// only built-in modules (electron, events, timers, url) are allowed.
const BACKEND_PORT = 8192;

interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id: string;
  appIcon: string | null;
}

const isWayland = process.platform === 'linux' &&
  (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');

const isDevMode = process.argv.includes('--dev') ||
  (globalThis as any).location?.port === '5173';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  apiBaseUrl: isDevMode ? '' : `http://localhost:${BACKEND_PORT}`,
  isWayland,
  platform: process.platform as 'win32' | 'linux' | 'darwin',

  minimize(): void {
    ipcRenderer.invoke('window:minimize');
  },

  maximize(): void {
    ipcRenderer.invoke('window:maximize');
  },

  close(): void {
    ipcRenderer.invoke('window:close');
  },

  focusWindow(): void {
    ipcRenderer.invoke('window:focus');
  },

  onMaximizedChange(callback: (maximized: boolean) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => {
      callback(maximized);
    };
    ipcRenderer.on('window:maximized-change', handler);
    return () => {
      ipcRenderer.removeListener('window:maximized-change', handler);
    };
  },

  getCaptureSources(): Promise<CaptureSource[]> {
    return ipcRenderer.invoke('capture:get-sources');
  },

  selectCaptureSource(sourceId: string): Promise<void> {
    return ipcRenderer.invoke('capture:select-source', sourceId);
  },

  setSystemPicker(enabled: boolean): Promise<void> {
    return ipcRenderer.invoke('capture:set-system-picker', enabled);
  },

  requestCameraAccess(): Promise<boolean> {
    return ipcRenderer.invoke('camera:request-access');
  },

  // --- macOS permissions IPC ---
  getPermissionStatus(): Promise<{ accessibility: boolean; screen_recording: boolean }> {
    return ipcRenderer.invoke('permissions:get-status');
  },

  requestPermission(permission: string): Promise<void> {
    return ipcRenderer.invoke('permissions:request', permission);
  },

  // --- Hotkey relay IPC (macOS) ---
  syncHotkeys(hotkeyMap: Record<string, string>): Promise<void> {
    return ipcRenderer.invoke('hotkeys:sync', hotkeyMap);
  },

  pauseHotkeys(): Promise<void> {
    return ipcRenderer.invoke('hotkeys:pause');
  },

  resumeHotkeys(): Promise<void> {
    return ipcRenderer.invoke('hotkeys:resume');
  },

  // --- Auto-update IPC ---
  onUpdateAvailable(callback: (info: { version: string; releaseDate: string }) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string; releaseDate: string }) => {
      callback(info);
    };
    ipcRenderer.on('update:available', handler);
    return () => {
      ipcRenderer.removeListener('update:available', handler);
    };
  },

  onUpdateProgress(callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
      callback(progress);
    };
    ipcRenderer.on('update:progress', handler);
    return () => {
      ipcRenderer.removeListener('update:progress', handler);
    };
  },

  onUpdateDownloaded(callback: () => void): () => void {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('update:downloaded', handler);
    return () => {
      ipcRenderer.removeListener('update:downloaded', handler);
    };
  },

  onUpdateError(callback: (message: string) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => {
      callback(message);
    };
    ipcRenderer.on('update:error', handler);
    return () => {
      ipcRenderer.removeListener('update:error', handler);
    };
  },

  checkForUpdate(): Promise<void> {
    return ipcRenderer.invoke('update:check');
  },

  downloadUpdate(): Promise<void> {
    return ipcRenderer.invoke('update:download');
  },

  installUpdate(): void {
    ipcRenderer.invoke('update:install');
  },

});
