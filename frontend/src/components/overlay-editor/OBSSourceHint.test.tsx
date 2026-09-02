/**
 * OBS browser source hint: the overlay URL it shows and the copy button.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";

// Mock the overlay utils
vi.mock("../../utils/overlay", () => ({
  resolveOverlay: (_p: unknown, _all: unknown, settings: unknown) => settings,
  wouldCreateCircularLink: () => false,
}));

// Mock the api utility
vi.mock("../../utils/api", () => ({
  apiUrl: (path: string) => `http://localhost:8192${path}`,
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  vi.stubGlobal("fetch", mockFetch);
  // Mock localStorage for tutorial and split state
  const store: Record<string, string> = { encounty_editor_tutorial_seen: "true" };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
  // Mock HTMLDialogElement methods not available in jsdom
  HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || vi.fn();
  HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || vi.fn();
});

describe("OverlayEditor", () => {
  // --- OBSSourceHint rendering ---

  it("renders OBS source hint without pokemon URL when no pokemon provided", async () => {
    const { OBSSourceHint } = await import("./OBSSourceHint");
    render(<OBSSourceHint />);
    // Should show "select pokemon" message when no pokemonId
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("OBS Browser Source");
  });

  it("renders OBS source hint with URL when pokemonId is provided", async () => {
    const { OBSSourceHint } = await import("./OBSSourceHint");
    render(<OBSSourceHint pokemonId="poke-1" />);
    // Should show the URL containing the pokemon ID
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("poke-1");
  });

  it("copies OBS URL to clipboard when copy button is clicked", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: writeTextMock },
    });

    const { OBSSourceHint } = await import("./OBSSourceHint");
    render(<OBSSourceHint pokemonId="poke-1" />);

    // Click the copy button (German: "Kopieren")
    const copyBtn = screen.getByText(/Kopieren|Copy/i);
    await user.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining("poke-1"));
  });

  // --- OBSSourceHint without pokemonId shows select message ---

  it("shows select pokemon message when no pokemonId in OBSSourceHint", async () => {
    const { OBSSourceHint } = await import("./OBSSourceHint");
    render(<OBSSourceHint />);
    const allText = document.body.textContent ?? "";
    // Should show the select pokemon message (no URL rendered)
    expect(allText).not.toContain("http");
  });

  // --- OBSSourceHint external link ---

  it("renders an external link to the overlay URL", async () => {
    const { OBSSourceHint } = await import("./OBSSourceHint");
    const { container } = render(<OBSSourceHint pokemonId="poke-abc" />);
    const externalLink = container.querySelector("a[target='_blank']");
    expect(externalLink).not.toBeNull();
    expect(externalLink?.getAttribute("href")).toContain("poke-abc");
  });
});
