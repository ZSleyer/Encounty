/**
 * metrics.ts serves the detector performance metrics behind a dev-only modal in
 * the renderer.
 *
 * Returns per-process CPU/memory snapshots from Chromium's task-manager
 * telemetry. Numbers follow the top(1) convention: 100 % = 1 saturated core.
 * Cheap to call (a few hundred microseconds) and safe to poll once per second.
 */

import { app, ipcMain } from "electron";
import os from "node:os";
import { getMainWindow } from "./main-window";
import { log } from "./logger";

/** CPU and memory reading for one Chromium child process. */
type ProcessSample = {
  pid: number;
  cpuPct: number;
  memMB: number;
  wakeups?: number;
};
/** The snapshot the renderer's performance modal displays. */
type ProcessStats = {
  renderer: ProcessSample | null;
  gpu: ProcessSample | null;
  browser: ProcessSample | null;
  utility: Array<ProcessSample & { name?: string }>;
  totalCpuPct: number;
  cpuCores: number;
  totalMemMB: number;
};

ipcMain.handle("metrics:get-process-stats", (): ProcessStats => {
  const metrics = app.getAppMetrics();
  const rendererPid = getMainWindow()?.webContents.getOSProcessId();
  const toSample = (m: Electron.ProcessMetric): ProcessSample => ({
    pid: m.pid,
    cpuPct: m.cpu.percentCPUUsage,
    memMB: m.memory.workingSetSize / 1024,
    wakeups: m.cpu.idleWakeupsPerSecond,
  });
  const renderer = metrics.find((m) => m.pid === rendererPid) ?? null;
  const gpu = metrics.find((m) => m.type === "GPU") ?? null;
  const browser = metrics.find((m) => m.type === "Browser") ?? null;
  const utility = metrics
    .filter((m) => m.type === "Utility")
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

ipcMain.handle("metrics:get-gpu-info", async () => {
  try {
    return await app.getGPUInfo("complete");
  } catch (err) {
    log.error("getGPUInfo failed:", err);
    return null;
  }
});
