/** Type declarations for the Electron preload API exposed via contextBridge. */

interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id: string;
  appIcon: string | null;
}

interface ProcessSample {
  pid: number;
  cpuPct: number;
  memMB: number;
  wakeups?: number;
}

interface ProcessStats {
  renderer: ProcessSample | null;
  gpu: ProcessSample | null;
  browser: ProcessSample | null;
  utility: Array<ProcessSample & { name?: string }>;
  totalCpuPct: number;
  cpuCores: number;
  totalMemMB: number;
}

interface GpuInfoBasic {
  auxAttributes?: Record<string, unknown>;
  gpuDevice?: Array<{
    active?: boolean;
    vendorId?: number;
    deviceId?: number;
    driverVendor?: string;
    driverVersion?: string;
    deviceString?: string;
  }>;
  machineModelName?: string;
  machineModelVersion?: string;
  [key: string]: unknown;
}

interface ElectronAPI {
  isElectron: true;
  apiBaseUrl: string;
  isWayland: boolean;
  /** True under Hyprland, which has no minimize and no window-managed maximize. */
  isHyprland: boolean;
  platform: "win32" | "linux" | "darwin";
  /** True when this build supports in-app auto-update (Linux, Windows NSIS install). */
  autoUpdate: boolean;
  /** True when a distribution package owns the install, so updates come from the package manager. */
  packageManaged: boolean;
  minimize(): void;
  maximize(): void;
  close(): void;
  focusWindow(): void;
  /** Current UI zoom factor. Only present in Electron builds. */
  getZoomFactor?(): Promise<number>;
  /** Sets the UI zoom factor; returns the value after clamping. */
  setZoomFactor?(factor: number): Promise<number>;
  /** Subscribes to zoom changes made via the keyboard shortcuts. */
  onZoomChange?(callback: (factor: number) => void): () => void;
  onMaximizedChange(callback: (maximized: boolean) => void): () => void;
  getCaptureSources(): Promise<CaptureSource[]>;
  selectCaptureSource(sourceId: string): Promise<void>;
  setSystemPicker(enabled: boolean): Promise<void>;
  requestCameraAccess(): Promise<boolean>;
  getPermissionStatus(): Promise<{ accessibility: boolean; screen_recording: boolean }>;
  requestPermission(permission: string): Promise<void>;
  syncHotkeys(hotkeyMap: Record<string, string>): Promise<void>;
  pauseHotkeys(): Promise<void>;
  resumeHotkeys(): Promise<void>;
  onUpdateAvailable(callback: (info: { version: string; releaseDate: string }) => void): () => void;
  onUpdateProgress(
    callback: (progress: {
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }) => void,
  ): () => void;
  onUpdateDownloaded(callback: () => void): () => void;
  onUpdateError(callback: (message: string) => void): () => void;
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;
  getProcessStats(): Promise<ProcessStats>;
  getGpuInfo(): Promise<GpuInfoBasic | null>;
  openFolderDialog?: (title?: string) => Promise<string | null>;
}

interface Window {
  electronAPI?: ElectronAPI;
}

/* eslint-disable no-var */
declare var electronAPI: ElectronAPI | undefined;
