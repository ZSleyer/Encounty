/**
 * app-ready.ts holds the one-time setup steps that must run after Electron
 * fires "ready".
 *
 * Each step is independent of the others; main.ts calls them in order so the
 * sequence stays visible in one place.
 */

import { app, Menu, nativeImage, net, protocol, session } from "electron";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { resolveAssetPath } from "./asset-path";
import { nativeStrings } from "./native-strings";
import { isDev } from "./config";
import { log } from "./logger";

/**
 * Configures the macOS Dock icon and the About panel. No-op elsewhere.
 *
 * The ICNS file gives the Dock its proper macOS styling, while the About panel
 * uses the PNG. The version stays empty until the backend reports it.
 */
export function setupDockAndAboutPanel(): void {
  if (process.platform !== "darwin") return;

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "app-icon.png")
    : path.join(__dirname, "..", "..", "frontend", "public", "app-icon.png");

  const icnsPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.icns")
    : path.join(__dirname, "..", "build", "icon.icns");
  const dockIcon = nativeImage.createFromPath(icnsPath);
  if (!dockIcon.isEmpty()) {
    app.dock?.setIcon(dockIcon);
  }

  // Set initial About panel, the version is updated after the backend reports it.
  const aboutIcon = nativeImage.createFromPath(iconPath);
  app.setAboutPanelOptions({
    applicationName: "Encounty",
    applicationVersion: "",
    copyright: "© 2026 ZSleyer",
    credits: nativeStrings().about.credits,
    ...(aboutIcon.isEmpty() ? {} : { iconPath }),
  });
}

/**
 * Registers the encounty:// protocol handler that serves the built frontend
 * from disk, with an SPA fallback to index.html.
 */
export function setupProtocolHandler(): void {
  const frontendRoot = app.isPackaged
    ? path.join(process.resourcesPath, "frontend-dist")
    : path.join(__dirname, "..", "..", "frontend", "dist");

  const frontendRootResolved = path.resolve(frontendRoot);
  const indexUrl = pathToFileURL(path.join(frontendRootResolved, "index.html")).toString();

  protocol.handle("encounty", (request) => {
    const url = new URL(request.url);
    // encounty://app/ is the only namespace the app ever loads.
    if (url.host !== "app") return new Response("Not Found", { status: 404 });

    const fullPath = resolveAssetPath(frontendRootResolved, url.pathname);
    if (fullPath === null) return new Response("Forbidden", { status: 403 });

    // SPA fallback: serve index.html for routes that don't map to files
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return net.fetch(indexUrl);
      }
      return net.fetch(pathToFileURL(fullPath).toString());
    } catch {
      return net.fetch(indexUrl);
    }
  });
}

/**
 * Installs the application menu.
 *
 * On macOS, setting the menu to null still shows the default Electron menu, so
 * a minimal app menu with the standard keyboard shortcuts is built instead.
 */
export function setupApplicationMenu(): void {
  if (process.platform === "darwin") {
    const menuStrings = nativeStrings().menu;
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: menuStrings.edit,
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: menuStrings.window,
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ],
        },
      ]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}

/**
 * Sets a strict Content-Security-Policy in production to suppress the
 * Electron CSP warning and harden the renderer against injection attacks.
 * In dev mode the Vite dev server requires more permissive settings.
 */
export function setupContentSecurityPolicy(): void {
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            [
              "default-src 'self' encounty:",
              // 'wasm-unsafe-eval' is required by Tesseract.js to compile and
              // instantiate its WebAssembly OCR core. It allows ONLY
              // WebAssembly.compile/instantiate, not arbitrary JS eval(), so
              // it is significantly safer than 'unsafe-eval'.
              "script-src 'self' encounty: 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline' encounty: https://fonts.googleapis.com",
              "img-src 'self' encounty: data: blob: http://localhost:* https:",
              "connect-src 'self' encounty: http://localhost:* ws://localhost:* https://pokeapi.co https://*.pokemon.com https://fonts.googleapis.com",
              "media-src 'self' blob: mediastream:",
              "worker-src 'self' blob: encounty:",
              "font-src 'self' encounty: data: https://fonts.gstatic.com",
            ].join("; "),
          ],
        },
      });
    });
  }
}

/**
 * Grants the permissions the app needs and auto-approves camera devices.
 *
 * 'local-fonts' backs the overlay editor's font picker: without it
 * queryLocalFonts() is rejected and the user can only pick the curated
 * families, even though their own fonts are installed and would render.
 */
export function setupPermissionHandlers(): void {
  const allowedPermissions = new Set([
    "media",
    "display-capture",
    "webgpu",
    "local-fonts",
    "clipboard-read",
    "clipboard-write",
    "clipboard-sanitized-write",
  ]);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    log.info("Permission request:", permission);
    callback(allowedPermissions.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    log.info("Permission check:", permission);
    return allowedPermissions.has(permission as string);
  });

  // Auto-grant camera device permissions so re-selecting the same camera
  // doesn't trigger repeated permission prompts.
  session.defaultSession.setDevicePermissionHandler((details) => {
    if ((details.deviceType as string) === "videoinput") return true;
    return false;
  });
}
