/**
 * Settings.backup.test.tsx: backup download and the restore upload flow.
 *
 * Split by feature area; the mocks and setup below are per file, so every
 * split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, makeAppState, userEvent, waitFor } from "../test-utils";
import { Settings } from "./Settings";
import { useCounterStore } from "../hooks/useCounterState";

/** Activate a settings tab by its accessible name (German labels in tests). */
async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole("tab", { name }));
}

const mockFetch = vi.fn();

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  });
  vi.stubGlobal("fetch", mockFetch);
  clipboardWriteText.mockClear();
  try {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
      writable: true,
    });
  } catch {
    // If jsdom refuses, fall back to direct assignment.
    (globalThis.navigator as unknown as { clipboard: unknown }).clipboard = {
      writeText: clipboardWriteText,
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Settings", () => {
  beforeEach(() => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders backup section with download and restore buttons", async () => {
    render(<Settings />);

    // Should have multiple buttons including backup and restore
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(5); // Has many buttons for various settings
    });
  });

  it("renders backup download and restore buttons", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // Backup and restore buttons live in the backup section on the data tab.
    expect(screen.getByText("Backup erstellen")).toBeInTheDocument();
    expect(screen.getByText("Backup wiederherstellen")).toBeInTheDocument();
  });

  it("handles restore file upload with successful response", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    // Find the hidden file input for restore
    const fileInput = document.querySelector(
      "input[type='file'][accept='.zip']",
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // Create a mock file and trigger change event
    const file = new File(["backup-data"], "encounty-backup.zip", { type: "application/zip" });
    await user.upload(fileInput, file);

    // Should call fetch with the restore endpoint
    await waitFor(() => {
      const restoreCall = mockFetch.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes("/api/restore"),
      );
      expect(restoreCall).toBeTruthy();
    });
  });

  it("handles restore file upload with error response", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/restore")) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: "Invalid backup" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const fileInput = document.querySelector(
      "input[type='file'][accept='.zip']",
    ) as HTMLInputElement;
    const file = new File(["bad-data"], "bad-backup.zip", { type: "application/zip" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      const restoreCall = mockFetch.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes("/api/restore"),
      );
      expect(restoreCall).toBeTruthy();
    });
  });

  it("handles restore file upload with network error", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/restore")) {
        return Promise.reject(new Error("Network failure"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const fileInput = document.querySelector(
      "input[type='file'][accept='.zip']",
    ) as HTMLInputElement;
    const file = new File(["data"], "backup.zip", { type: "application/zip" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      const restoreCall = mockFetch.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes("/api/restore"),
      );
      expect(restoreCall).toBeTruthy();
    });
  });

  it("renders backup button that can be clicked without crash", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    const backupBtn = screen.getByText(/Backup erstellen|Create backup/i).closest("button")!;
    expect(backupBtn).toBeTruthy();

    // Click should not throw (downloadBackup creates a temporary anchor element)
    await user.click(backupBtn);

    // Button should still be in the DOM after click
    expect(backupBtn).toBeInTheDocument();
  });
});
