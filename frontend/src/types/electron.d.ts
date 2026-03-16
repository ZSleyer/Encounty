/** Type declarations for the Electron preload API exposed via contextBridge. */

interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id: string;
  appIcon: string | null;
}

interface ElectronAPI {
  isElectron: true;
  isWayland: boolean;
  platform: 'win32' | 'linux';
  minimize(): void;
  maximize(): void;
  close(): void;
  focusWindow(): void;
  onMaximizedChange(callback: (maximized: boolean) => void): () => void;
  getCaptureSources(): Promise<CaptureSource[]>;
  selectCaptureSource(sourceId: string): Promise<void>;
  onUpdateAvailable(callback: (info: { version: string; releaseDate: string }) => void): () => void;
  onUpdateProgress(callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): () => void;
  onUpdateDownloaded(callback: () => void): () => void;
  onUpdateError(callback: (message: string) => void): () => void;
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
