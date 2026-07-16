// after-pack.js: electron-builder afterPack hook.
//
// Windows is packaged for x64 and arm64 in a single electron-builder invocation so both
// installers end up in one auto-update feed (latest.yml), from which electron-updater
// picks the file whose name matches the running arch. The Go backend sidecar is
// arch-specific and is bundled via extraResources from the fixed x64 path, so for the
// arm64 pack the x64 backend is swapped for the arm64 build here, after electron-builder
// has copied the resources into place.
const path = require("path");
const fs = require("fs/promises");

// builder-util Arch enum values: x64 = 1, arm64 = 3.
const ARCH = { 1: "x64", 3: "arm64" };

/**
 * electron-builder afterPack hook. For the Windows arm64 pack only, replaces the bundled
 * x64 backend sidecar with the arm64 build; a no-op for every other platform/arch.
 * @param {import("app-builder-lib").AfterPackContext} context
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32" || ARCH[context.arch] !== "arm64") {
    return;
  }
  const projectDir = context.packager.projectDir; // the electron/ directory
  const src = path.join(projectDir, "..", "encounty-backend-windows-arm64.exe");
  const dest = path.join(context.appOutDir, "resources", "encounty-backend-windows.exe");
  await fs.copyFile(src, dest);
  console.log(`[after-pack] win arm64: swapped in ${path.basename(src)}`);
};
