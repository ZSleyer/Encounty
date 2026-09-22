/**
 * hotkeys.ts registers the global hotkeys Electron owns and the IPC channels
 * the renderer drives them with.
 *
 * On macOS, the Go backend cannot register CGEventTap hotkeys because it runs
 * as a child process without Accessibility permission. Instead, Electron
 * registers globalShortcuts and relays triggered actions to the Go backend.
 *
 * The binding list is owned by the backend: one entry per resolved hotkey,
 * which may target one specific hunt or group instead of the active one.
 */

import { globalShortcut, ipcMain, net } from "electron";
import { BACKEND_PORT } from "./config";
import { createLogger } from "./logger";

const log = createLogger("[Hotkeys]");

/** One resolved hotkey binding as served by GET /api/hotkeys/bindings. */
interface HotkeyBinding {
  action: string;
  combo: string;
  pokemon_id?: string;
  group_id?: string;
}

/** Accelerators currently held by globalShortcut, used to release them again. */
let registeredAccelerators: string[] = [];
/** Fingerprint of the binding list the registered accelerators came from. */
let appliedFingerprint: string | null = null;
let hotkeysPaused = false;
/** Guards against two in-flight syncs resolving out of order. */
let syncSequence = 0;

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

/**
 * Builds an order-independent fingerprint of a binding list. The backend may
 * serialize its bindings in any order, so a plain JSON comparison would report
 * a change on every poll and defeat the rebuild skip.
 */
function fingerprintBindings(bindings: HotkeyBinding[]): string {
  return bindings
    .map((b) => `${b.action}|${b.combo}|${b.pokemon_id ?? ""}|${b.group_id ?? ""}`)
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

/** Builds the trigger URL for a binding, carrying its target in the query string. */
function triggerUrl(binding: HotkeyBinding): string {
  const params = new URLSearchParams();
  if (binding.pokemon_id) params.set("pokemon_id", binding.pokemon_id);
  if (binding.group_id) params.set("group_id", binding.group_id);
  const query = params.toString();
  const base = `http://localhost:${BACKEND_PORT}/api/hotkeys/trigger/${binding.action}`;
  return query ? `${base}?${query}` : base;
}

/** Short human-readable description of a binding's target, for the log line. */
function describeTarget(binding: HotkeyBinding): string {
  if (binding.pokemon_id) return `hunt ${binding.pokemon_id}`;
  if (binding.group_id) return `group ${binding.group_id}`;
  return "active target";
}

/** Releases every accelerator this module currently holds. */
function unregisterAll(): void {
  for (const accel of registeredAccelerators) {
    try {
      globalShortcut.unregister(accel);
    } catch {
      /* ignore */
    }
  }
  registeredAccelerators = [];
}

/** Fetches the resolved binding list, or null when the backend is unreachable. */
async function fetchBindings(): Promise<HotkeyBinding[] | null> {
  try {
    const response = await net.fetch(`http://localhost:${BACKEND_PORT}/api/hotkeys/bindings`);
    if (!response.ok) {
      log.warn(`Bindings request failed with status ${response.status}`);
      return null;
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      log.warn("Bindings response was not an array");
      return null;
    }
    return data as HotkeyBinding[];
  } catch (err) {
    log.error("Failed to fetch hotkey bindings:", err);
    return null;
  }
}

/** Registers one accelerator per binding, replacing whatever is registered now. */
function applyBindings(bindings: HotkeyBinding[]): void {
  const fingerprint = fingerprintBindings(bindings);
  // The renderer syncs on every state broadcast, which means on every single
  // encounter. Re-registering identical accelerators that often drops key
  // presses that land during the teardown.
  if (!hotkeysPaused && fingerprint === appliedFingerprint) return;

  unregisterAll();

  if (hotkeysPaused) {
    // Resume re-fetches the same list, so the cache must not claim it is live.
    appliedFingerprint = null;
    return;
  }

  for (const binding of bindings) {
    if (!binding?.combo || !binding.action) continue;

    const accelerator = toElectronAccelerator(binding.combo);
    if (!accelerator) {
      log.warn(`Cannot convert "${binding.combo}" to Electron accelerator`);
      continue;
    }

    const url = triggerUrl(binding);
    const action = binding.action;
    try {
      // A stale list can still carry a collision the backend would reject;
      // register() then returns false instead of throwing.
      const ok = globalShortcut.register(accelerator, () => {
        net.fetch(url, { method: "POST" }).catch((err: unknown) => {
          log.error(`Failed to trigger ${action}:`, err);
        });
      });
      if (!ok) {
        log.warn(`Accelerator "${accelerator}" is already taken, skipping ${action}`);
        continue;
      }
      registeredAccelerators.push(accelerator);
      log.info(`Registered: ${accelerator} → ${action} (${describeTarget(binding)})`);
    } catch (err) {
      log.warn(`Failed to register "${accelerator}":`, err);
    }
  }

  appliedFingerprint = fingerprint;
}

/**
 * Re-reads the resolved hotkey bindings from the backend and rebuilds the
 * global shortcuts from them. A failed fetch leaves the current registrations
 * in place rather than dropping the user's hotkeys.
 */
async function syncElectronHotkeys(): Promise<void> {
  if (process.platform !== "darwin") return;

  const sequence = ++syncSequence;
  const bindings = await fetchBindings();
  if (!bindings) return;
  // A slower earlier fetch must not overwrite a newer list.
  if (sequence !== syncSequence) return;

  applyBindings(bindings);
}

// The payload is ignored: the channel is only a "something changed" signal,
// the binding list always comes from the backend.
ipcMain.handle("hotkeys:sync", () => syncElectronHotkeys());

ipcMain.handle("hotkeys:pause", () => {
  hotkeysPaused = true;
  unregisterAll();
  // Invalidate the cache so resume actually rebuilds.
  appliedFingerprint = null;
});

ipcMain.handle("hotkeys:resume", () => {
  hotkeysPaused = false;
  return syncElectronHotkeys();
});
