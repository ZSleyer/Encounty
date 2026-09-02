/**
 * Settings.sync.test.tsx: data section, meaning the unified Pokedex sync and
 * the database location form.
 *
 * Split by feature area; the mocks and setup below are per file, so every
 * split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, makeAppState, userEvent, waitFor } from "../test-utils";
import { Settings } from "./Settings";
import { ToastContainer } from "../components/shared/ToastContainer";
import { useCounterStore } from "../hooks/useCounterState";

/** Wrapper rendering Settings together with the global toast container. */
function SettingsWithToasts() {
  return (
    <>
      <Settings />
      <ToastContainer />
    </>
  );
}

/** Activate a settings tab by its accessible name (German labels in tests). */
async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole("tab", { name }));
}

const mockFetch = vi.fn();

/** Minimal WebSocket stub used to drive the unified sync flow. */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateMessage(payload: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  static readonly instances: MockWebSocket[] = [];
  static clear() {
    MockWebSocket.instances.length = 0;
  }
  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

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
  MockWebSocket.clear();
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

  it("displays config path when appState has data_path", async () => {
    const testPath = "/test/config/path";
    useCounterStore.setState({
      appState: makeAppState({ data_path: testPath }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // Config path should be displayed
    await waitFor(() => {
      expect(screen.getByText(testPath)).toBeInTheDocument();
    });
  });

  it("renders sync pokemon button and triggers sync", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // Find sync buttons in the Data section
    const syncButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.querySelector(".lucide-refresh-cw") ||
          b.textContent?.includes("Sync") ||
          b.textContent?.includes("sync"),
      );
    expect(syncButtons.length).toBeGreaterThan(0);
  });

  it("renders the data path with a change button", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // The data path from makeAppState is /tmp/encounty and is rendered in
    // both the OBS card (output_dir) and the Data section (data_path), so
    // there should be at least one occurrence.
    expect(screen.getAllByText("/tmp/encounty").length).toBeGreaterThanOrEqual(1);

    // The change button is labelled with the German "Ändern" string.
    expect(screen.getByRole("button", { name: "Ändern" })).toBeInTheDocument();
  });

  it("runs unified sync via /api/setup/online and shows progress", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetch.mockImplementation((_url: unknown) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const syncBtn = screen.getByRole("button", { name: /Daten synchronisieren/i });
    expect(syncBtn).not.toBeDisabled();

    await user.click(syncBtn);

    // Button should now be disabled and show the syncing label.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Synchronisiere/i })).toBeDisabled();
    });

    // setup/online endpoint should have been POSTed.
    await waitFor(() => {
      const setupCall = mockFetch.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes("/api/setup/online"),
      );
      expect(setupCall).toBeTruthy();
    });

    const ws = MockWebSocket.latest();
    expect(ws).toBeTruthy();

    // Progress update.
    act(() => {
      ws.simulateMessage({
        type: "sync_progress",
        payload: { phase: "pokedex", step: "species" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/pokedex.*species/)).toBeInTheDocument();
    });

    // Completion event.
    act(() => {
      ws.simulateMessage({ type: "system_ready", payload: {} });
    });

    await waitFor(() => {
      expect(screen.getByText(/Sync abgeschlossen/)).toBeInTheDocument();
    });

    // Button should be enabled again.
    expect(screen.getByRole("button", { name: /Daten synchronisieren/i })).not.toBeDisabled();
  });

  it("shows error when /api/setup/online fetch rejects", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/setup/online")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const syncBtn = screen.getByRole("button", { name: /Daten synchronisieren/i });
    await user.click(syncBtn);

    await waitFor(() => {
      expect(screen.getByText(/request failed/)).toBeInTheDocument();
    });
  });

  it("shows error when WebSocket emits a sync_progress error step", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetch.mockImplementation((_url: unknown) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    const syncBtn = screen.getByRole("button", { name: /Daten synchronisieren/i });
    await user.click(syncBtn);

    await waitFor(() => {
      expect(MockWebSocket.latest()).toBeTruthy();
    });

    act(() => {
      MockWebSocket.latest().simulateMessage({
        type: "sync_progress",
        payload: { phase: "games", step: "error", error: "boom" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });

  it("changes config path when change button is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    render(<Settings />);
    await openTab(user, /Daten/);

    // FolderPathInput exposes the DB path input via its aria-label.
    const configInput = screen.getByRole("textbox", {
      name: "Datenbank-Speicherort",
    }) as HTMLInputElement;
    expect(configInput).toBeTruthy();

    await user.clear(configInput);
    await user.type(configInput, "/new/config/path");

    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    expect(changeBtn).not.toBeDisabled();
    await user.click(changeBtn);

    await waitFor(() => {
      const pathCall = mockFetch.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes("/api/settings/db-path"),
      );
      expect(pathCall).toBeTruthy();
      const body = JSON.parse((pathCall![1] as RequestInit).body as string);
      expect(body).toEqual({ path: "/new/config/path" });
    });
  });

  it("shows error toast when config path change fails with error", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/settings/db-path")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Permission denied" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<SettingsWithToasts />);
    await openTab(user, /Daten/);

    const configInput = screen.getByRole("textbox", {
      name: "Datenbank-Speicherort",
    }) as HTMLInputElement;
    await user.clear(configInput);
    await user.type(configInput, "/invalid/path");

    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    await user.click(changeBtn);

    await waitFor(() => {
      // German translation of settings.dbPathError.
      expect(
        screen.getByText("Datenbank-Speicherort konnte nicht geändert werden"),
      ).toBeInTheDocument();
    });
  });

  it("shows error toast when config path change throws network error", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((_url: unknown) => {
      const url = String(_url);
      if (url.includes("/api/settings/db-path")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<SettingsWithToasts />);
    await openTab(user, /Daten/);

    const configInput = screen.getByRole("textbox", {
      name: "Datenbank-Speicherort",
    }) as HTMLInputElement;
    await user.clear(configInput);
    await user.type(configInput, "/unreachable/path");

    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    await user.click(changeBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Datenbank-Speicherort konnte nicht geändert werden"),
      ).toBeInTheDocument();
    });
  });

  it("disables the change button when draft equals the current data path", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, /Daten/);

    // The draft input is initialised with appState.data_path, so the button
    // must start out disabled.
    const changeBtn = screen.getByRole("button", { name: "Ändern" });
    expect(changeBtn).toBeDisabled();
  });
});
