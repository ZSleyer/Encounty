import "@testing-library/jest-dom/vitest";
import { JSDOM } from "jsdom";

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
