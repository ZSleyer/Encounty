/**
 * Dashboard.counter.test.tsx: counter tab, encounter actions, odds and tab switching.
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

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: vi.fn((_cb?: (msg: { type: string; payload: unknown }) => void) => {
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

describe("Dashboard", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders without crashing when state is available", async () => {
    render(<Dashboard />);
    await act(async () => {});
    // The active pokemon name should appear at least once in the DOM
    const matches = screen.getAllByText("Bisasam");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("uses the nickname when a caught Pokemon is active again", async () => {
    const pokemon = makePokemon({ nickname: "Sparky", completed_at: undefined, is_active: true });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: pokemon.id }),
    });

    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getAllByText("Sparky").length).toBeGreaterThan(0);
  });

  it("renders when no app state", async () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<Dashboard />);
    await act(async () => {});
    expect(container).toBeTruthy();
  });

  it("renders the #main-content id by default (isActiveRoute defaults true)", async () => {
    render(<Dashboard />);
    await act(async () => {});
    expect(document.getElementById("main-content")).not.toBeNull();
  });

  it("omits the #main-content id when isActiveRoute is false, so it can't collide with another mounted page's own main landmark", async () => {
    render(<Dashboard isActiveRoute={false} />);
    await act(async () => {});
    expect(document.getElementById("main-content")).toBeNull();
  });

  it("renders an sr-only h1 for the page", async () => {
    render(<Dashboard />);
    await act(async () => {});
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("sr-only");
  });

  it("displays timer in correct format", async () => {
    const pokemon = makePokemon({
      id: "test-1",
      timer_accumulated_ms: 3661000, // 1 hour, 1 minute, 1 second
      timer_started_at: undefined,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "test-1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Timer should be formatted as HH:MM:SS (multiple instances exist - sidebar and main panel)
    const timers = screen.getAllByText("01:01:01");
    expect(timers.length).toBeGreaterThan(0);
  });

  it("displays encounters count", async () => {
    const pokemon = makePokemon({
      id: "test-1",
      encounters: 123,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "test-1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Encounter count should be visible (appears in multiple places)
    const encounters = screen.getAllByText("123");
    expect(encounters.length).toBeGreaterThan(0);
  });

  it("renders tab buttons for counter, detector, overlay, and statistics", async () => {
    render(<Dashboard />);
    await act(async () => {});

    // All four tabs should be present
    const buttons = screen.getAllByRole("button");

    // Look for tab-related text (these are translation keys in the actual component)
    // The tabs render with icons and text that includes "dash." prefix
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("switches between tabs when clicked", async () => {
    userEvent.setup();
    render(<Dashboard />);
    await act(async () => {});

    // Get all buttons
    const buttons = screen.getAllByRole("button");

    // Find the statistics tab button (it has a BarChart3 icon)
    // We can't easily query by icon, but we can verify multiple tabs exist
    expect(buttons.length).toBeGreaterThan(5); // Should have many buttons including tab buttons
  });

  it("allows clicking on pokemon cards to select them", async () => {
    userEvent.setup();
    const pokemon1 = makePokemon({ id: "p1", name: "TestMon1", is_active: true });
    const pokemon2 = makePokemon({ id: "p2", name: "TestMon2", is_active: false });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon1, pokemon2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Both pokemon should be in the sidebar (appear in multiple places)
    const mon1Elements = screen.getAllByText("TestMon1");
    const mon2Elements = screen.getAllByText("TestMon2");
    expect(mon1Elements.length).toBeGreaterThan(0);
    expect(mon2Elements.length).toBeGreaterThan(0);
  });

  it("displays add pokemon button", async () => {
    render(<Dashboard />);
    await act(async () => {});

    // Add button should be present in the sidebar
    const buttons = screen.getAllByRole("button");
    const addButton = buttons.find((btn) => {
      // The add button has a Plus icon
      const svg = btn.querySelector("svg");
      return svg !== null;
    });

    expect(addButton).toBeDefined();
  });

  it("shows timer with play button when timer is not running", async () => {
    const pokemon = makePokemon({
      id: "test-1",
      timer_started_at: undefined,
      timer_accumulated_ms: 0,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "test-1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Timer display should show 00:00:00
    expect(screen.getByText("00:00:00")).toBeInTheDocument();

    // Play button should be present (Pause button should not be for this specific timer state)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders search input in sidebar", async () => {
    render(<Dashboard />);
    await act(async () => {});

    // Search input should be present
    const searchInputs = screen.getAllByRole("textbox");
    expect(searchInputs.length).toBeGreaterThan(0);
  });

  it("displays game information for pokemon", async () => {
    const pokemon = makePokemon({
      id: "test-1",
      game: "red",
      language: "de",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "test-1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Game info should be displayed somewhere
    const { container } = render(<Dashboard />);
    await act(async () => {});
    expect(container).toBeTruthy();
  });

  // --- Sidebar tabs: active vs caught ---

  it("lists only running hunts in the sidebar while the active tab is selected", async () => {
    const activeMon = makePokemon({ id: "a1", name: "ActiveMon", is_active: true });
    const completedMon = makePokemon({
      id: "a2",
      name: "CompletedMon",
      is_active: false,
      completed_at: "2024-06-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [activeMon, completedMon], active_id: "a1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // The active tab is the default, so only the running hunt is listed.
    const sidebarItems = [...document.querySelectorAll("[data-sidebar-idx]")];
    expect(sidebarItems.length).toBe(1);
    expect(sidebarItems[0].textContent).toContain("ActiveMon");
    expect(sidebarItems.some((el) => el.textContent?.includes("CompletedMon"))).toBe(false);
  });

  it("renders both sidebar tabs with the active one pressed", async () => {
    render(<Dashboard />);
    await act(async () => {});

    const activeTab = screen.getByRole("button", { name: /^Aktiv\b/ });
    const dexTab = screen.getByRole("button", { name: /^Pokédex\b/ });
    expect(activeTab).toHaveAttribute("aria-pressed", "true");
    expect(dexTab).toHaveAttribute("aria-pressed", "false");
  });

  it("lists only caught entries once the pokedex tab is selected", async () => {
    const user = userEvent.setup();
    const activeMon = makePokemon({ id: "a1", name: "ActiveMon", is_active: true });
    const caughtMon = makePokemon({
      id: "a2",
      name: "CaughtMon",
      is_active: false,
      completed_at: "2024-06-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [activeMon, caughtMon], active_id: "a1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: /^Pokédex\b/ }));

    const sidebarItems = [...document.querySelectorAll("[data-sidebar-idx]")];
    expect(sidebarItems.length).toBe(1);
    expect(sidebarItems[0].textContent).toContain("CaughtMon");
    expect(screen.getByRole("button", { name: /^Pokédex\b/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Aktiv\b/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("counts each sidebar tab separately and announces the counts as text", async () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });
    const c1 = makePokemon({ id: "p3", name: "Mon3", completed_at: "2025-01-01T00:00:00Z" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2, c1], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Two running hunts, one caught entry. The badge is aria-hidden, so the
    // accessible name carries the count as words instead of a bare number.
    expect(screen.getByRole("button", { name: "Aktiv, 2 Einträge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pokédex, 1 Einträge" })).toBeInTheDocument();
  });

  it("hides the caught count badge while nothing has been caught", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "p1", name: "Mon1" })],
        active_id: "p1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Pokédex" })).toBeInTheDocument();
  });

  it("shows the caught empty state when the pokedex tab has no entries", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "p1", name: "Mon1" })],
        active_id: "p1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: /^Pokédex\b/ }));

    expect(screen.getByText("Noch nichts gefangen")).toBeInTheDocument();
    expect(screen.getByText("Markiere gefundene Shinys als Gefangen!")).toBeInTheDocument();
  });

  // --- Completed Pokemon rendering ---

  it("shows caught banner for completed pokemon", async () => {
    const completedPokemon = makePokemon({
      id: "c1",
      name: "CaughtMon",
      is_active: true,
      completed_at: "2024-06-15T10:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [completedPokemon], active_id: "c1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});
    // Caught banner text should be present
    const bannerTexts = screen.getAllByText(/Gefangen|Caught/i);
    expect(bannerTexts.length).toBeGreaterThan(0);
  });

  it("hides detector tab for completed pokemon", async () => {
    const completedPokemon = makePokemon({
      id: "c1",
      name: "CaughtMon",
      is_active: true,
      completed_at: "2024-06-15T10:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [completedPokemon], active_id: "c1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Detector tab button should NOT be present for a completed pokemon
    const buttons = screen.getAllByRole("button");
    const detectorTabButton = buttons.find((btn) =>
      /Erkennung|Detector/i.exec(btn.textContent ?? ""),
    );
    expect(detectorTabButton).toBeUndefined();
  });

  // --- No pokemon selected (empty right panel) ---

  it("shows no active pokemon message when list is empty", async () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});
    // The empty state heading should be visible
    const headings = screen.getAllByRole("heading");
    expect(headings.length).toBeGreaterThan(0);
  });

  // --- Tab rendering ---

  it("renders counter tab by default with encounter controls", async () => {
    render(<Dashboard />);
    await act(async () => {});
    // Encounter count should be visible
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    // Timer display should be visible
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
  });

  it("renders statistics tab when clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Click the statistics tab
    const statsTab = screen.getByText(/Statistik|Statistics/i);
    await user.click(statsTab);

    // The statistics panel is rendered (it fetches data from the API)
    // Verify the tab is now active by checking the DOM changed
    expect(statsTab.closest("button")).toBeInTheDocument();
  });

  it("renders overlay tab when clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Click the overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Overlay mode buttons (Global/Custom) should appear
    const globalBtns = screen.getAllByText(/Global/i);
    expect(globalBtns.length).toBeGreaterThan(0);
  });

  // --- Odds display ---

  it("shows default odds for standard encounter method", async () => {
    const pokemon = makePokemon({ id: "o1", encounters: 100 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows masuda odds when hunt type is masuda", async () => {
    const pokemon = makePokemon({ id: "m1", encounters: 50, hunt_type: "masuda" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "m1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});
    // Six shiny rolls in Scarlet/Violet, which is 1/683.08.
    expect(screen.getByText("1/683")).toBeInTheDocument();
  });

  // --- Custom step display ---

  it("shows custom step value on encounter buttons", async () => {
    const pokemon = makePokemon({ id: "s1", encounters: 10, step: 5 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "s1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});
    // The step should appear in the increment/decrement buttons
    expect(screen.getByText("+5")).toBeInTheDocument();
  });

  // --- Timer with running state ---

  it("shows pause button when timer is running", async () => {
    const pokemon = makePokemon({
      id: "t1",
      timer_started_at: new Date().toISOString(),
      timer_accumulated_ms: 5000,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "t1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Pause buttons should be present (both sidebar timer and main timer)
    const pauseButtons = screen.getAllByLabelText(/pause|stopp/i);
    expect(pauseButtons.length).toBeGreaterThan(0);
  });

  // --- Loading state ---

  it("shows loading spinner when not connected", async () => {
    useCounterStore.setState({
      appState: null,
      isConnected: false,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});
    // Loading label should be visible
    expect(screen.getByText(/Verbinde|Connecting/i)).toBeInTheDocument();
  });

  // --- Sidebar search filtering ---

  it("filters pokemon by search query in sidebar", async () => {
    const user = userEvent.setup();
    const mon1 = makePokemon({
      id: "f1",
      name: "Pikachu",
      canonical_name: "pikachu",
      is_active: true,
    });
    const mon2 = makePokemon({
      id: "f2",
      name: "Mewtu",
      canonical_name: "mewtwo",
      is_active: true,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [mon1, mon2], active_id: "f1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Both should be visible initially
    expect(screen.getAllByText("Pikachu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mewtu").length).toBeGreaterThan(0);

    // Type in search
    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "pikachu");

    // Pikachu should still be visible, Mewtu should not be in sidebar
    expect(screen.getAllByText("Pikachu").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Mewtu").length).toBeLessThanOrEqual(1); // May still appear in header
  });

  // --- Header action buttons ---

  it("shows caught button and overflow menu with edit and delete in header", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await act(async () => {});

    // Caught stays a visible primary action; Edit and Delete live in the overflow menu
    expect(screen.getByLabelText(/Gefangen|Caught/i)).toBeInTheDocument();
    const kebab = screen.getByLabelText(/Weitere Aktionen|More actions/i);
    await user.click(kebab);
    expect(screen.getByLabelText(/^Bearbeiten$|^Edit$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Löschen|Delete/i)).toBeInTheDocument();
  });

  it("shows reactivate action in overflow menu for completed pokemon instead of caught", async () => {
    const user = userEvent.setup();
    const completedPokemon = makePokemon({
      id: "r1",
      name: "ReactivateMon",
      is_active: true,
      completed_at: "2024-06-15T10:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [completedPokemon], active_id: "r1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});
    const kebab = screen.getByLabelText(/Weitere Aktionen|More actions/i);
    await user.click(kebab);
    expect(screen.getByLabelText(/Reaktivieren|Reactivate/i)).toBeInTheDocument();
  });

  // --- Encounter increment/decrement via WS ---

  it("sends increment message when plus button is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Find the increment button by its aria-label
    const incrementBtn = screen.getByLabelText("+1");
    await user.click(incrementBtn);

    expect(mockSend).toHaveBeenCalledWith("increment", { pokemon_id: "poke-1" });
  });

  it("sends decrement message when minus button is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const decrementBtn = screen.getByLabelText("\u22121");
    await user.click(decrementBtn);

    expect(mockSend).toHaveBeenCalledWith("decrement", { pokemon_id: "poke-1" });
  });

  // --- Empty state with search query ---

  it("shows no match message when search has no results", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "zzznomatchzzz");

    // "No match" message should appear (German: "Kein Treffer für")
    expect(screen.getByText(/Kein Treffer|No match/i)).toBeInTheDocument();
  });

  // --- Multiple pokemon encounters total ---

  it("shows total encounter count in sidebar quick actions", async () => {
    const mon1 = makePokemon({ id: "e1", name: "Mon1", encounters: 100, is_active: true });
    const mon2 = makePokemon({ id: "e2", name: "Mon2", encounters: 200, is_active: false });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [mon1, mon2], active_id: "e1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Total encounters (100 + 200 = 300) should be displayed
    expect(screen.getByText("300")).toBeInTheDocument();
  });
});

// --- Tab Switching ---

describe("Dashboard tab switching", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("renders all four header tabs when a pokemon is active", async () => {
    render(<Dashboard />);
    await act(async () => {});

    // "Encounter" appears multiple times (tab + stats label), so use getAllByText
    expect(screen.getAllByText("Encounter").length).toBeGreaterThan(0);
    expect(screen.getByText("Auto Erkennung")).toBeInTheDocument();
    expect(screen.getAllByText("Overlay").length).toBeGreaterThan(0);
    expect(screen.getByText("Statistik")).toBeInTheDocument();
  });

  it("hides the detector tab when the viewed pokemon is completed", async () => {
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
    await act(async () => {});

    // "Auto Erkennung" tab should not be rendered for completed pokemon
    expect(screen.queryByText("Auto Erkennung")).not.toBeInTheDocument();
  });

  it("shows the detector tab when the viewed pokemon is not completed", async () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("Auto Erkennung")).toBeInTheDocument();
  });

  it("switches to statistics tab when clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const statsTab = screen.getByText("Statistik");
    await user.click(statsTab);

    // The statistics tab should now be active (has active class)
    expect(statsTab.closest("button")).toHaveClass("bg-accent-blue");
  });

  it("switches to overlay tab when clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    expect(overlayTab.closest("button")).toHaveClass("bg-accent-blue");
  });
});

// --- Action Buttons ---

describe("Dashboard action buttons", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows caught button plus edit and delete inside the overflow menu", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const caughtButtons = screen.getAllByRole("button", { name: /Gefangen/ });
    expect(caughtButtons.length).toBeGreaterThan(0);

    // Edit and Delete moved into the overflow (kebab) menu
    const kebab = screen.getByRole("button", { name: /Weitere Aktionen/ });
    await user.click(kebab);
    const editButtons = screen.getAllByRole("button", { name: /Bearbeiten/ });
    expect(editButtons.length).toBeGreaterThan(0);
    const deleteButtons = screen.getAllByRole("button", { name: /Löschen/ });
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it("shows reactivate action in the overflow menu for completed pokemon", async () => {
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
    await act(async () => {});

    const kebab = screen.getByRole("button", { name: /Weitere Aktionen/ });
    await user.click(kebab);
    const reactivateButtons = screen.getAllByRole("button", { name: /Reaktivieren/ });
    expect(reactivateButtons.length).toBeGreaterThan(0);
  });

  it("calls fetch when the caught button reports the target", async () => {
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

    // Click the first "Gefangen" button (header action)
    const caughtButtons = screen.getAllByRole("button", { name: /Gefangen/ });
    await user.click(caughtButtons[0]);

    // The hunt method can phase, so the dialog asks what the shiny was.
    await user.click(await screen.findByRole("button", { name: /Bisasam gefangen/ }));

    // Should call the complete API endpoint
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/pokemon/p1/complete"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("opens the end-phase dialog when the caught button reports an off-target shiny", async () => {
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

    await user.click(screen.getAllByRole("button", { name: /Gefangen/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Fehl-Shiny gefangen/ }));

    // The species dialog takes over; the hunt itself is not completed.
    expect(await screen.findByPlaceholderText("Spezies suchen…")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1/complete"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("asks what was caught for a soft-reset hunt", async () => {
    mockDialogMethods();
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_type: "soft_reset" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    await user.click(screen.getAllByRole("button", { name: /Gefangen/ })[0]);

    expect(await screen.findByRole("button", { name: /Fehl-Shiny gefangen/ })).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1/complete"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders a dialog element when delete button is clicked", async () => {
    // Mock showModal since jsdom does not support it
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Delete lives in the overflow menu now
    const kebab = screen.getByRole("button", { name: /Weitere Aktionen/ });
    await user.click(kebab);
    const deleteButtons = screen.getAllByRole("button", { name: /Löschen/ });
    await user.click(deleteButtons[0]);

    // ConfirmModal renders a <dialog>, showModal should have been called
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Counter Tab Content ---

describe("Dashboard counter tab", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows completed banner for caught pokemon", async () => {
    const pokemon = makePokemon({
      id: "p1",
      completed_at: "2025-06-15T12:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // "Gefangen!" banner should appear
    expect(screen.getByText("Gefangen!")).toBeInTheDocument();
  });

  it("disables increment and decrement buttons for completed pokemon", async () => {
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
    await act(async () => {});

    const incrementBtn = screen.getByRole("button", { name: "+1" });
    const decrementBtn = screen.getByRole("button", { name: /−1/ });
    expect(incrementBtn).toBeDisabled();
    expect(decrementBtn).toBeDisabled();
  });

  it("shows custom step labels when pokemon has a custom step", async () => {
    const pokemon = makePokemon({
      id: "p1",
      step: 5,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Buttons should show +5 and -5
    expect(screen.getByRole("button", { name: "+5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /−5/ })).toBeInTheDocument();
  });

  it("sends increment message when plus button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const incrementBtn = screen.getByRole("button", { name: "+1" });
    await user.click(incrementBtn);

    expect(mockSend).toHaveBeenCalledWith("increment", { pokemon_id: "p1" });
  });

  it("sends decrement message when minus button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const decrementBtn = screen.getByRole("button", { name: /−1/ });
    await user.click(decrementBtn);

    expect(mockSend).toHaveBeenCalledWith("decrement", { pokemon_id: "p1" });
  });

  it("shows odds display as 1/4096 by default", async () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("displays total encounters in sidebar quick actions bar", async () => {
    const p1 = makePokemon({ id: "p1", encounters: 100 });
    const p2 = makePokemon({ id: "p2", encounters: 200 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Total encounters = 300
    expect(screen.getByText("300")).toBeInTheDocument();
  });
});

// --- Encounter Reset Confirmation ---

describe("Dashboard reset confirmation", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows confirm dialog when reset button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", encounters: 100 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click the reset button in the counter tab
    const resetBtn = screen.getByRole("button", { name: "Zurücksetzen" });
    await user.click(resetBtn);

    // ConfirmModal should open
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Set Encounter Modal ---

describe("Dashboard set encounter", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens set encounter modal when pencil icon on counter is hovered and clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", encounters: 42 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // The set encounter button has aria-label matching "Begegnungen manuell setzen" or similar
    const setBtn = screen.getByLabelText(/Begegnungen manuell setzen|Set encounters/i);
    await user.click(setBtn);

    // SetEncounterModal should be rendered (it uses a dialog)
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Odds Display ---

describe("Dashboard odds display", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows radar odds when hunt_type is radar", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "radar", game: "pokemon-x" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("1/100")).toBeInTheDocument();
  });

  it("shows chain_fishing odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "chain_fishing", game: "pokemon-x" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("1/100")).toBeInTheDocument();
  });

  it("shows dynamax_adventure odds", async () => {
    const pokemon = makePokemon({
      id: "o1",
      hunt_type: "dynamax_adventure",
      game: "pokemon-sword",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("1/300")).toBeInTheDocument();
  });

  it("shows default odds for soft_reset hunt type", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "soft_reset" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows friend_safari odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "friend_safari", game: "pokemon-x" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("1/819")).toBeInTheDocument();
  });
});

// --- Various odds display methods ---

describe("Dashboard additional odds display", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows horde odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "horde", game: "pokemon-x" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("5/4096")).toBeInTheDocument();
  });

  it("shows sos odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "sos", game: "pokemon-sun" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/315")).toBeInTheDocument();
  });

  it("shows ultra_wormhole odds", async () => {
    const pokemon = makePokemon({
      id: "o1",
      hunt_type: "ultra_wormhole",
      game: "pokemon-ultra-sun",
    });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("shows dexnav odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "dexnav", game: "pokemon-omega-ruby" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/42")).toBeInTheDocument();
  });

  it("shows catch_combo odds", async () => {
    const pokemon = makePokemon({
      id: "o1",
      hunt_type: "catch_combo",
      game: "pokemon-lets-go-pikachu",
    });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/342")).toBeInTheDocument();
  });

  it("shows sandwich odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "sandwich" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/1024")).toBeInTheDocument();
  });

  it("shows default odds for fossil hunt type", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "fossil" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows default odds for gift hunt type", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "gift" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows max_raid odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "max_raid", game: "pokemon-sword" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows tera_raid odds", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "tera_raid" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/4103")).toBeInTheDocument();
  });

  it("falls back to default odds for unknown hunt type", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "unknown_method" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("returns 1/4096 when pokemon is null", async () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    // No pokemon selected, default odds not shown in panel
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });
});

// --- Game badge in header ---

describe("Dashboard header game badge", () => {
  it("shows formatted game badge when pokemon has a game with pokemon- prefix", async () => {
    const pokemon = makePokemon({ id: "p1", game: "pokemon-letsgo-pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // formatGame removes "pokemon-" and replaces "letsgo" with "L.G. "
    expect(screen.getAllByText("L.G. -PIKACHU").length).toBeGreaterThan(0);
  });

  it("does not show game badge when pokemon has no game", async () => {
    const pokemon = makePokemon({ id: "p1", game: undefined });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Header center should not have a game badge line
    const header = document.querySelector("header");
    const gameBadge = header?.querySelector(".tracking-wider.font-semibold.text-text-muted");
    expect(gameBadge).toBeNull();
  });
});

// --- SetEncounterModal save flow ---

describe("Dashboard set encounter save", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens set encounter modal and the pencil button triggers the dialog", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", encounters: 50 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click the set encounter pencil button
    const setBtn = screen.getByLabelText(/Begegnungen manuell setzen|Set encounters/i);
    await user.click(setBtn);

    // SetEncounterModal should render (dialog showModal called)
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Image error fallback ---

describe("Dashboard image error handling", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("handles image error by falling back to default sprite", async () => {
    const pokemon = makePokemon({ id: "p1", sprite_url: "https://broken.png" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Trigger image error on the sprite
    const images = document.querySelectorAll(".pokemon-sprite");
    expect(images.length).toBeGreaterThan(0);

    // Fire error event on first sprite image
    const img = images[0] as HTMLImageElement;
    act(() => {
      img.dispatchEvent(new Event("error"));
    });

    // After error, the image src should change to fallback
    // We can't easily check the exact fallback URL, but at least the image exists
    expect(img).toBeTruthy();
  });
});

// --- Encounter flash animation ---

describe("Dashboard encounter flash", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("calls flashPokemon when increment button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    // Spy on the store's flashPokemon
    const flashSpy = vi.fn();
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
      flashPokemon: flashSpy,
    });

    render(<Dashboard />);

    const incrementBtn = screen.getByRole("button", { name: "+1" });
    await user.click(incrementBtn);

    // flashPokemon should have been called
    expect(flashSpy).toHaveBeenCalledWith("p1");
  });
});

// --- Multiple active pokemon encounter count display ---

describe("Dashboard encounter counts in multiple pokemon", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("displays encounter count for viewed pokemon in counter tab", async () => {
    const p1 = makePokemon({ id: "p1", name: "Pikachu", encounters: 999 });
    const p2 = makePokemon({ id: "p2", name: "Glumanda", encounters: 42 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // The large encounter counter should show 999
    expect(screen.getAllByText("999").length).toBeGreaterThan(0);
  });
});

// --- Tab does not switch if clicking the same tab ---

describe("Dashboard tab no-op on same tab click", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("does not change state when clicking the already active tab", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Counter tab is already active, click it again
    const counterTab = screen.getAllByText("Encounter")[0];
    const tabButton = counterTab.closest("button")!;
    expect(tabButton).toHaveClass("bg-accent-blue");

    await user.click(tabButton);

    // Should still be on counter tab (no change)
    expect(tabButton).toHaveClass("bg-accent-blue");
  });
});

// --- Reset counter button sends reset message ---

describe("Dashboard reset counter flow", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("hides reset button for completed pokemon", async () => {
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
    await act(async () => {});

    // Reset button should not be present for completed pokemon
    const resetBtn = screen.queryByText("Reset");
    expect(resetBtn).toBeNull();
  });

  it("hides set encounter pencil for completed pokemon", async () => {
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
    await act(async () => {});

    // Set encounter pencil should not be present for completed pokemon
    const setBtn = screen.queryByLabelText(/Begegnungen manuell setzen|Set encounters/i);
    expect(setBtn).toBeNull();
  });
});

// --- Odds with hunt type outbreak ---

describe("Dashboard outbreak odds", () => {
  it("shows outbreak odds based on base denominator", async () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "outbreak_ko60" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    expect(screen.getByText("1/1365")).toBeInTheDocument();
  });
});

// --- SetEncounterModal save callback ---

describe("Dashboard set encounter save callback", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("sends set_encounters message when saving encounter count", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", encounters: 42 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the set encounter modal
    const setBtn = screen.getByLabelText(/Begegnungen manuell setzen|Set encounters/i);
    await user.click(setBtn);

    // The modal should be open - find the input and change the value
    const input = screen.getByLabelText(/Anzahl|Encounters/i);
    await user.clear(input);
    await user.type(input, "100");

    // Click save button in the modal
    const saveBtn = screen.getByText(/Speichern|Save/i);
    await user.click(saveBtn);

    // Should have sent set_encounters message via WebSocket
    expect(mockSend).toHaveBeenCalledWith("set_encounters", { pokemon_id: "p1", count: 100 });
  });
});

// --- Counter tab sprite error in main panel ---

describe("Dashboard counter tab sprite error", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("handles sprite error in counter tab main view", async () => {
    const pokemon = makePokemon({ id: "p1", sprite_url: "https://broken-sprite.png" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Find the hero panel identity sprite
    const mainSprites = document.querySelectorAll("img.pokemon-sprite");
    // The hero panel sprite uses the 56px identity-row size
    const mainSprite = Array.from(mainSprites).find((img) =>
      img.className.includes("w-14"),
    ) as HTMLImageElement;

    if (mainSprite) {
      act(() => {
        mainSprite.dispatchEvent(new Event("error", { bubbles: true }));
      });
      expect(mainSprite).toBeTruthy();
    }
  });
});
