import "@testing-library/jest-dom/vitest";
import { JSDOM } from "jsdom";
import { beforeEach } from "vitest";
import { resetPokedexCache } from "./utils/pokedexData";
import { resetTrimmedSpriteCache } from "./components/shared/TrimmedBoxSprite";

// Node 26+ defines globalThis.localStorage as undefined (requires --localstorage-file)
// which shadows jsdom's injection because the property is non-writable. We spin up a
// minimal JSDOM instance to obtain a real Storage object and class, then inject both
// so that vi.spyOn(Storage.prototype, …) targets the correct prototype.
if (typeof globalThis.localStorage === "undefined") {
  const tempDom = new JSDOM("", { url: "http://localhost" });
  const w = tempDom.window as unknown as { localStorage: Storage; Storage: typeof Storage };

  Object.defineProperty(globalThis, "Storage", {
    value: w.Storage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: w.localStorage,
    writable: true,
    configurable: true,
  });
}

// jsdom has no ResizeObserver. Components use it to react to their own box
// changing, which jsdom never reports anyway (every element measures 0), so a
// stub that observes nothing is behaviourally accurate here rather than a
// shortcut. Tests that need an observation to fire install their own stub.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom implements neither dialog.showModal() nor dialog.close(). Toggling the
// `open` attribute is the part the components depend on: it decides whether the
// dialog's content reaches the accessibility tree and whether the shared close
// helper considers the dialog open. Test files that deliberately want a no-op
// still assign their own stub; those written as `prototype.showModal || vi.fn()`
// keep this one. There is no top layer here, so stacking is not reproduced.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ) {
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

// Two module-level caches outlive a single test: the pokedex payloads in
// utils/pokedexData.ts and the trimmed sprites in TrimmedBoxSprite. Suites
// re-stub `fetch` and `Image` between cases and expect the next mount to reach
// for them again, so both are dropped before every test.
beforeEach(() => {
  resetPokedexCache();
  resetTrimmedSpriteCache();
});
