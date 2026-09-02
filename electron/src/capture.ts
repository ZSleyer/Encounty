/**
 * capture.ts owns screen capture: enumerating sources for the picker, the
 * source the renderer pre-selected, and the display media request handler
 * Chromium consults when getDisplayMedia() runs.
 *
 * All three share the pre-selected id and the source cache, so they stay in one
 * module.
 */

import { desktopCapturer, ipcMain, session, systemPreferences } from "electron";
import { isWayland } from "./config";
import { log } from "./logger";

// Source ID pre-selected by the renderer via capture:select-source IPC.
// Consumed once by setDisplayMediaRequestHandler, then reset to null.
let pendingSourceId: string | null = null;

// Capture source enumeration returns screens and windows with thumbnails.
// Also caches the raw DesktopCapturerSource objects for reuse in the display
// media handler, avoiding a second getSources() call whose IDs may not resolve
// correctly in Electron ≥41.1 (OverconstrainedError on deviceId).
let cachedCaptureSources: Electron.DesktopCapturerSource[] = [];

ipcMain.handle("capture:get-sources", async () => {
  if (isWayland) {
    log.info("capture:get-sources skipped on Wayland");
    return [];
  }
  // On macOS, check screen recording permission and log status for debugging.
  // desktopCapturer.getSources() silently returns empty results when denied.
  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    log.info("macOS screen recording status:", status);
    if (status !== "granted") {
      log.warn(
        "Screen recording not granted — sources will be empty. Grant permission in System Settings > Privacy > Screen Recording.",
      );
    }
  }
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  cachedCaptureSources = sources;
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    display_id: s.display_id,
    appIcon: s.appIcon?.toDataURL() ?? null,
  }));
});

// Pre-select a source ID so the next getDisplayMedia call uses it
ipcMain.handle("capture:select-source", (_e: Electron.IpcMainInvokeEvent, sourceId: string) => {
  log.info("capture:select-source called with:", sourceId);
  pendingSourceId = sourceId;
});

/**
 * Installs the display media request handler and the IPC channel that switches
 * it to the macOS system picker.
 *
 * Must run once the app is ready, because it touches session.defaultSession.
 */
export function setupDisplayMedia(): void {
  // Electron REQUIRES setDisplayMediaRequestHandler, without it getDisplayMedia()
  // is always denied ("Not supported"). On Wayland, desktopCapturer.getSources()
  // triggers the PipeWire portal once per call, which is fine here (only called
  // when the user actually clicks Connect). The repeated thumbnail polling
  // (capture:get-sources IPC) is already guarded to skip on Wayland.
  // Uses cachedCaptureSources from the SourcePickerModal's thumbnail fetch to
  // avoid a second getSources() call that may produce stale/invalid source IDs
  // in Electron ≥41.1. Falls back to a fresh query if cache is empty.
  const displayMediaHandler: Parameters<
    typeof session.defaultSession.setDisplayMediaRequestHandler
  >[0] = (_request, callback) => {
    void (async () => {
      log.info(
        "setDisplayMediaRequestHandler invoked, isWayland:",
        isWayland,
        "pendingSourceId:",
        pendingSourceId,
        "cached:",
        cachedCaptureSources.length,
      );
      try {
        // Prefer cached sources from the SourcePickerModal's thumbnail fetch,
        // the same objects that Chromium's device enumeration already knows about.
        const sources =
          cachedCaptureSources.length > 0
            ? cachedCaptureSources
            : await desktopCapturer.getSources({ types: ["screen", "window"] });
        log.info("Using", sources.length, "sources (cached:", cachedCaptureSources.length > 0, ")");

        if (!sources.length) {
          // @ts-expect-error -- calling with no args denies the request
          callback();
          return;
        }

        if (pendingSourceId) {
          const wanted = pendingSourceId;
          pendingSourceId = null;
          // The cache can predate the user's pick (a window opened after the
          // last thumbnail fetch), so re-query once before giving up.
          let selected = sources.find((s) => s.id === wanted);
          if (!selected && cachedCaptureSources.length > 0) {
            const fresh = await desktopCapturer.getSources({ types: ["screen", "window"] });
            selected = fresh.find((s) => s.id === wanted);
          }
          if (!selected) {
            // Never substitute a different source: silently capturing the wrong
            // window is worse than a failed connect the user can react to.
            log.info("Pre-selected source is gone:", wanted);
            // @ts-expect-error -- calling with no args denies the request
            callback();
            return;
          }
          log.info("Picking source:", selected.id, selected.name);
          callback({ video: selected });
        } else {
          log.info("Picking first source:", sources[0].id, sources[0].name);
          callback({ video: sources[0] });
        }
      } catch (err) {
        pendingSourceId = null;
        log.info("Display media request failed:", err);
        // @ts-expect-error -- calling with no args denies the request
        callback();
      }
    })();
  };

  session.defaultSession.setDisplayMediaRequestHandler(displayMediaHandler);

  // Allow the renderer to dynamically switch to the macOS system picker
  // as a fallback when the custom handler produces OverconstrainedError.
  ipcMain.handle(
    "capture:set-system-picker",
    (_e: Electron.IpcMainInvokeEvent, enabled: boolean) => {
      log.info("capture:set-system-picker:", enabled);
      session.defaultSession.setDisplayMediaRequestHandler(displayMediaHandler, {
        useSystemPicker: enabled,
      });
    },
  );
}
