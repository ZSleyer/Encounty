/**
 * hotkeys.ts registers the global hotkeys Electron owns and the IPC channels
 * the renderer drives them with.
 *
 * On macOS, the Go backend cannot register CGEventTap hotkeys because it runs
 * as a child process without Accessibility permission. Instead, Electron
 * registers globalShortcuts and relays triggered actions to the Go backend.
 */

import { globalShortcut, ipcMain, net } from "electron";
import { BACKEND_PORT } from "./config";
import { createLogger } from "./logger";

const log = createLogger("[Hotkeys]");

/** Maps action names to their currently registered accelerator string. */
let registeredHotkeys: Record<string, string> = {};
let hotkeysPaused = false;

/** Map of special key names to their Electron accelerator equivalents. */
const ELECTRON_KEY_MAP: Record<string, string> = {
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  escape: "Escape",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  space: "Space",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  // numpaddivide maps to numdiv (NOT numdec, which is the decimal key);
  // a copy-paste slip here once broke numpad-slash hotkeys on macOS.
  numpadadd: "numadd",
  numpadsubtract: "numsub",
  numpadmultiply: "nummult",
  numpaddivide: "numdiv",
  numpadenter: "Enter",
  numpaddecimal: "numdec",
  numpad0: "num0",
  numpad1: "num1",
  numpad2: "num2",
  numpad3: "num3",
  numpad4: "num4",
  numpad5: "num5",
  numpad6: "num6",
  numpad7: "num7",
  numpad8: "num8",
  numpad9: "num9",
  "+": "Plus",
  "-": "-",
  "=": "=",
  "[": "[",
  "]": "]",
  ";": ";",
  "'": "'",
  ",": ",",
  ".": ".",
  "/": "/",
  "\\": "\\",
  "`": "`",
};

/**
 * Resolves a single lowercase key name to its Electron accelerator string.
 * Returns null for unrecognized keys.
 */
function resolveElectronKey(lower: string): string | null {
  if (lower === "ctrl" || lower === "control") return "Control";
  if (lower === "shift") return "Shift";
  if (lower === "alt") return "Alt";

  const mapped = ELECTRON_KEY_MAP[lower];
  if (mapped) return mapped;
  if (lower.startsWith("f") && /^f\d+$/.test(lower)) return lower.toUpperCase();
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
  if (combo === "+") return "Plus";

  const parts = combo.split("+");
  const mapped: string[] = [];

  for (const part of parts) {
    const electronKey = resolveElectronKey(part.toLowerCase().trim());
    if (!electronKey) return null;
    mapped.push(electronKey);
  }
  return mapped.join("+");
}

/** Unregisters all current hotkeys and registers new ones from the hotkey map. */
function syncElectronHotkeys(hotkeyMap: Record<string, string>): void {
  if (process.platform !== "darwin") return;

  for (const accel of Object.values(registeredHotkeys)) {
    try {
      globalShortcut.unregister(accel);
    } catch {
      /* ignore */
    }
  }
  registeredHotkeys = {};

  if (hotkeysPaused) return;

  const actionMap: Record<string, string> = {
    increment: "increment",
    decrement: "decrement",
    reset: "reset",
    next_pokemon: "next",
  };

  for (const [frontendAction, combo] of Object.entries(hotkeyMap)) {
    if (!combo) continue;
    const backendAction = actionMap[frontendAction] ?? frontendAction;
    const accelerator = toElectronAccelerator(combo);
    if (!accelerator) {
      log.warn(`Cannot convert "${combo}" to Electron accelerator`);
      continue;
    }

    try {
      const action = backendAction;
      globalShortcut.register(accelerator, () => {
        net
          .fetch(`http://localhost:${BACKEND_PORT}/api/hotkeys/trigger/${action}`, {
            method: "POST",
          })
          .catch((err: unknown) => {
            log.error(`Failed to trigger ${action}:`, err);
          });
      });
      registeredHotkeys[frontendAction] = accelerator;
      log.info(`Registered: ${frontendAction} → ${accelerator} → ${action}`);
    } catch (err) {
      log.warn(`Failed to register "${accelerator}":`, err);
    }
  }
}

ipcMain.handle(
  "hotkeys:sync",
  (_e: Electron.IpcMainInvokeEvent, hotkeyMap: Record<string, string>) => {
    syncElectronHotkeys(hotkeyMap);
  },
);

ipcMain.handle("hotkeys:pause", () => {
  hotkeysPaused = true;
  for (const accel of Object.values(registeredHotkeys)) {
    try {
      globalShortcut.unregister(accel);
    } catch {
      /* ignore */
    }
  }
});

ipcMain.handle("hotkeys:resume", () => {
  hotkeysPaused = false;
  net
    .fetch(`http://localhost:${BACKEND_PORT}/api/state`)
    .then((r) => r.json())
    .then((state: any) => {
      if (state?.hotkeys) {
        syncElectronHotkeys(state.hotkeys);
      }
    })
    .catch((err: unknown) => log.error("Failed to re-sync after resume:", err));
});
