/**
 * Dashboard.modals.test.tsx: add, edit, confirm and reset dialogs plus the header actions.
 *
 * Split out of the original Dashboard.test.tsx; the mocks and setup below are
 * per file, so every split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState, makePokemon, userEvent, act, waitFor } from "../test-utils";
import { Dashboard } from "./Dashboard";
import { useCounterStore } from "../hooks/useCounterState";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    // Return array for endpoints that expect array responses
    if (
      typeof url === "string" &&
      (url.includes("/api/hunt-types") || url.includes("/api/games"))
    ) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });
  vi.stubGlobal("fetch", mockFetch);
});

const mockSend = vi.fn();
let capturedWsCallback: ((msg: { type: string; payload: unknown }) => void) | null = null;

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: vi.fn((cb?: (msg: { type: string; payload: unknown }) => void) => {
    if (cb) capturedWsCallback = cb;
    return { send: mockSend };
  }),
}));

// Mock engine modules that require WebGPU / browser-only APIs
vi.mock("../engine/DetectionLoop", () => ({
  isLoopRunning: vi.fn(() => false),
  getActiveLoop: vi.fn(() => null),
}));

vi.mock("../engine/startDetection", () => ({
  startDetectionForPokemon: vi.fn(),
  stopDetectionForPokemon: vi.fn(),
  ensureDetector: vi.fn(() => Promise.resolve()),
  getDetectorBackend: vi.fn(() => "gpu"),
  setForceCPU: vi.fn(),
  isForceCPU: vi.fn(() => false),
  reloadDetectionTemplates: vi.fn(),
}));

/**
 * jsdom implements neither showModal nor close: make both flip the open
 * attribute so a <dialog> behaves like an open modal and the close transition
 * of useDialogClose still terminates.
 */
function mockDialogMethods() {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

// --- Edit Pokemon Modal ---

describe("Dashboard edit pokemon", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens edit modal when header edit button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const editBtns = screen.getAllByRole("button", { name: /Bearbeiten|Edit/i });
    await user.click(editBtns[0]);

    // EditPokemonModal should be rendered
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("opens edit modal when sidebar edit button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Hover over the sidebar item to reveal the edit button
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    expect(sidebarItem).toBeTruthy();

    // Find the pencil edit button within the sidebar item
    const editBtn = sidebarItem!.querySelector(
      "button[title*='Bearbeiten'], button[title*='Edit']",
    );
    if (editBtn) {
      await user.click(editBtn as HTMLElement);
      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    }
  });
});

// --- Add Pokemon Modal ---

describe("Dashboard add pokemon", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens add modal when sidebar add button is clicked", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const addBtn = screen.getByText("Pokémon hinzufügen");
    await user.click(addBtn);

    // AddPokemonModal should be rendered
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("opens add modal from empty state 'add first' button", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const addFirstBtn = screen.getByText(/Erstes Pokémon hinzufügen/);
    await user.click(addFirstBtn);

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Uncomplete (Reactivate) ---

describe("Dashboard reactivate pokemon", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("calls uncomplete API when reactivate button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      completed_at: "2025-01-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Reactivate lives in the overflow menu now
    const kebab = screen.getByRole("button", { name: /Weitere Aktionen/i });
    await user.click(kebab);
    const reactivateBtns = screen.getAllByRole("button", { name: /Reaktivieren/i });
    await user.click(reactivateBtns[0]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1/uncomplete"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// --- Edit modal close flow ---

describe("Dashboard edit modal close", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens edit modal and modal renders for the correct pokemon", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click edit
    const editBtns = screen.getAllByRole("button", { name: /Bearbeiten|Edit/i });
    await user.click(editBtns[0]);

    // The edit modal should be open with the pokemon name
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Confirm modal close ---

describe("Dashboard confirm modal close", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("triggers delete confirmation state when delete button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "DeleteMe" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the overflow menu, then click the delete action
    const kebab = screen.getByRole("button", { name: /Weitere Aktionen|More actions/i });
    await user.click(kebab);
    const deleteBtns = screen.getAllByRole("button", { name: /Löschen|Delete/i });
    await user.click(deleteBtns[0]);

    // After clicking delete, the confirm dialog title should appear
    expect(screen.getByText(/Pokémon löschen|Delete Pokémon/i)).toBeInTheDocument();
  });
});

// --- AddPokemonModal close callback ---

describe("Dashboard add modal close", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("closes add modal when close button is clicked", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the add modal
    const addBtn = screen.getByText("Pokémon hinzufügen");
    await user.click(addBtn);

    // The modal should be open
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();

    // Find and click the close button in the modal (aria-label close)
    const closeButtons = screen.getAllByLabelText(/schließen|close/i);
    // The last close button should be in the modal
    await user.click(closeButtons[closeButtons.length - 1]);

    // Modal should be closed, the add button should be back to normal
    expect(screen.getByText("Pokémon hinzufügen")).toBeInTheDocument();
  });
});

// --- EditPokemonModal close callback ---

describe("Dashboard edit modal close callback", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("closes edit modal when close button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the edit modal
    const editBtns = screen.getAllByRole("button", { name: /Bearbeiten|Edit/i });
    await user.click(editBtns[0]);

    // Modal should be open
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();

    // Click close button
    const closeButtons = screen.getAllByLabelText(/schließen|close/i);
    await user.click(closeButtons[closeButtons.length - 1]);

    // Modal should be closed
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Pikachu");
  });
});

// --- Header edit button specifically (line 2200) ---

describe("Dashboard header edit button", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens edit modal from header edit button (not sidebar)", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the header overflow menu, then find the edit action inside the header
    const header = document.querySelector("header");
    const kebab = header?.querySelector(
      "button[aria-label*='Weitere Aktionen'], button[aria-label*='More actions']",
    ) as HTMLElement;
    expect(kebab).toBeTruthy();
    await user.click(kebab);

    const headerEditBtn = header?.querySelector(
      "button[aria-label*='Bearbeiten'], button[aria-label*='Edit']",
    ) as HTMLElement;
    expect(headerEditBtn).toBeTruthy();

    await user.click(headerEditBtn);

    // EditPokemonModal should be rendered
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Header delete button specifically ---

describe("Dashboard header delete button", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens confirm dialog from header delete button", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the header overflow menu, then find the delete action inside the header
    const header = document.querySelector("header");
    const kebab = header?.querySelector(
      "button[aria-label*='Weitere Aktionen'], button[aria-label*='More actions']",
    ) as HTMLElement;
    expect(kebab).toBeTruthy();
    await user.click(kebab);

    const headerDeleteBtn = header?.querySelector(
      "button[aria-label*='Löschen'], button[aria-label*='Delete']",
    ) as HTMLElement;
    expect(headerDeleteBtn).toBeTruthy();

    await user.click(headerDeleteBtn);

    // ConfirmModal should render
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Header caught button specifically ---

describe("Dashboard header caught button", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("calls complete API from header caught button", async () => {
    mockDialogMethods();
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find the caught button specifically inside the header
    const header = document.querySelector("header");
    const headerCaughtBtn = header?.querySelector(
      "button[aria-label*='Gefangen'], button[aria-label*='Caught']",
    ) as HTMLElement;
    expect(headerCaughtBtn).toBeTruthy();

    await user.click(headerCaughtBtn);
    // The hunt can phase, so confirm in the dialog that it really was the target.
    await user.click(await screen.findByRole("button", { name: /Bisasam gefangen/ }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/pokemon/p1/complete"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

// --- Header reactivate button specifically ---

describe("Dashboard header reactivate button", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("calls uncomplete API from header reactivate button", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      completed_at: "2025-01-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the header overflow menu, then find the reactivate action inside the header
    const header = document.querySelector("header");
    const kebab = header?.querySelector(
      "button[aria-label*='Weitere Aktionen'], button[aria-label*='More actions']",
    ) as HTMLElement;
    expect(kebab).toBeTruthy();
    await user.click(kebab);

    const headerReactivateBtn = header?.querySelector(
      "button[aria-label*='Reaktivieren'], button[aria-label*='Reactivate']",
    ) as HTMLElement;
    expect(headerReactivateBtn).toBeTruthy();

    await user.click(headerReactivateBtn);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1/uncomplete"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// --- Header overflow menu behavior ---

describe("Dashboard header overflow menu", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [makePokemon({ id: "p1" })], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("opens on click, closes on Escape, and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await act(async () => {});

    const kebab = screen.getByRole("button", { name: /Weitere Aktionen/ });
    expect(kebab).toHaveAttribute("aria-expanded", "false");

    // Open: menu actions become visible (getByLabelText matches aria-label only,
    // so the sidebar pencil button with a title attribute does not interfere)
    await user.click(kebab);
    expect(kebab).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/^Bearbeiten$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Löschen$/)).toBeInTheDocument();

    // Escape closes the menu and focus returns to the kebab trigger
    await user.keyboard("{Escape}");
    expect(kebab).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/^Bearbeiten$/)).not.toBeInTheDocument();
    expect(kebab).toHaveFocus();
  });
});

// --- WebSocket request_reset_confirm message handling ---

describe("Dashboard WebSocket reset confirm", () => {
  beforeEach(() => {
    mockSend.mockReset();
    capturedWsCallback = null;
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows confirm dialog when request_reset_confirm message is received", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    const pokemon = makePokemon({ id: "p1", name: "Pikachu", encounters: 100 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // The WS callback should have been captured
    expect(capturedWsCallback).not.toBeNull();

    // Simulate receiving a request_reset_confirm message
    await act(async () => {
      capturedWsCallback!({ type: "request_reset_confirm", payload: { pokemon_id: "p1" } });
    });

    // ConfirmModal should be open with reset confirmation text
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("ignores non-reset messages in WS callback", async () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(capturedWsCallback).not.toBeNull();

    // Simulate receiving a non-reset message
    capturedWsCallback!({ type: "state_update", payload: {} });

    // No confirm dialog should open
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });
});
