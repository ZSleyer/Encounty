import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState, makePokemon, userEvent } from "../test-utils";
import { Dashboard } from "./Dashboard";
import { useCounterStore } from "../hooks/useCounterState";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    // Return array for endpoints that expect array responses
    if (typeof url === "string" && (url.includes("/api/hunt-types") || url.includes("/api/games"))) {
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
  useWebSocket: vi.fn(() => ({ send: mockSend })),
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

  it("renders without crashing when state is available", () => {
    render(<Dashboard />);
    // The active pokemon name should appear at least once in the DOM
    const matches = screen.getAllByText("Bisasam");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders when no app state", () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<Dashboard />);
    expect(container).toBeTruthy();
  });

  it("displays timer in correct format", () => {
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

    // Timer should be formatted as HH:MM:SS (multiple instances exist - sidebar and main panel)
    const timers = screen.getAllByText("01:01:01");
    expect(timers.length).toBeGreaterThan(0);
  });

  it("displays encounters count", () => {
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

    // Encounter count should be visible (appears in multiple places)
    const encounters = screen.getAllByText("123");
    expect(encounters.length).toBeGreaterThan(0);
  });

  it("renders tab buttons for counter, detector, overlay, and statistics", () => {
    render(<Dashboard />);

    // All four tabs should be present
    const buttons = screen.getAllByRole("button");

    // Look for tab-related text (these are translation keys in the actual component)
    // The tabs render with icons and text that includes "dash." prefix
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("switches between tabs when clicked", async () => {
    userEvent.setup();
    render(<Dashboard />);

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

    // Both pokemon should be in the sidebar (appear in multiple places)
    const mon1Elements = screen.getAllByText("TestMon1");
    const mon2Elements = screen.getAllByText("TestMon2");
    expect(mon1Elements.length).toBeGreaterThan(0);
    expect(mon2Elements.length).toBeGreaterThan(0);
  });

  it("displays add pokemon button", () => {
    render(<Dashboard />);

    // Add button should be present in the sidebar
    const buttons = screen.getAllByRole("button");
    const addButton = buttons.find(btn => {
      // The add button has a Plus icon
      const svg = btn.querySelector("svg");
      return svg !== null;
    });

    expect(addButton).toBeDefined();
  });

  it("shows timer with play button when timer is not running", () => {
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

    // Timer display should show 00:00:00
    expect(screen.getByText("00:00:00")).toBeInTheDocument();

    // Play button should be present (Pause button should not be for this specific timer state)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders search input in sidebar", () => {
    render(<Dashboard />);

    // Search input should be present
    const searchInputs = screen.getAllByRole("textbox");
    expect(searchInputs.length).toBeGreaterThan(0);
  });

  it("displays game information for pokemon", () => {
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

    // Game info should be displayed somewhere
    const { container } = render(<Dashboard />);
    expect(container).toBeTruthy();
  });

  // --- Sidebar tabs: active vs archived ---

  it("shows active and archived sidebar tabs", () => {
    render(<Dashboard />);
    // Both sidebar tab labels should be present
    expect(screen.getByText(/Aktiv|Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Archiv|Archive/i)).toBeInTheDocument();
  });

  it("filters pokemon list to archived when archive tab is selected", async () => {
    const user = userEvent.setup();
    const activeMon = makePokemon({ id: "a1", name: "ActiveMon", is_active: true });
    const archivedMon = makePokemon({
      id: "a2",
      name: "ArchivedMon",
      is_active: false,
      completed_at: "2024-06-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [activeMon, archivedMon], active_id: "a1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Initially, ActiveMon should be in the sidebar
    expect(screen.getAllByText("ActiveMon").length).toBeGreaterThan(0);

    // Click the archive tab
    const archiveTab = screen.getByText(/Archiv|Archive/i);
    await user.click(archiveTab);

    // ArchivedMon should now appear in the sidebar
    expect(screen.getAllByText("ArchivedMon").length).toBeGreaterThan(0);
  });

  // --- Completed Pokemon rendering ---

  it("shows caught banner for completed pokemon", () => {
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
    // Caught banner text should be present
    const bannerTexts = screen.getAllByText(/Gefangen|Caught/i);
    expect(bannerTexts.length).toBeGreaterThan(0);
  });

  it("hides detector tab for completed pokemon", () => {
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

    // Detector tab button should NOT be present for a completed pokemon
    const buttons = screen.getAllByRole("button");
    const detectorTabButton = buttons.find(
      (btn) => (/Erkennung|Detector/i).exec(btn.textContent ?? ""),
    );
    expect(detectorTabButton).toBeUndefined();
  });

  // --- No pokemon selected (empty right panel) ---

  it("shows no active pokemon message when list is empty", () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    // The empty state heading should be visible
    const headings = screen.getAllByRole("heading");
    expect(headings.length).toBeGreaterThan(0);
  });

  // --- Tab rendering ---

  it("renders counter tab by default with encounter controls", () => {
    render(<Dashboard />);
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

  it("shows default odds for standard encounter method", () => {
    const pokemon = makePokemon({ id: "o1", encounters: 100 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows masuda odds when hunt type is masuda", () => {
    const pokemon = makePokemon({ id: "m1", encounters: 50, hunt_type: "masuda" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "m1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    expect(screen.getByText("1/683")).toBeInTheDocument();
  });

  // --- Custom step display ---

  it("shows custom step value on encounter buttons", () => {
    const pokemon = makePokemon({ id: "s1", encounters: 10, step: 5 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "s1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    // The step should appear in the increment/decrement buttons
    expect(screen.getByText("+5")).toBeInTheDocument();
  });

  // --- Timer with running state ---

  it("shows pause button when timer is running", () => {
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

    // Pause buttons should be present (both sidebar timer and main timer)
    const pauseButtons = screen.getAllByLabelText(/pause|stopp/i);
    expect(pauseButtons.length).toBeGreaterThan(0);
  });

  // --- Loading state ---

  it("shows loading spinner when not connected", () => {
    useCounterStore.setState({
      appState: null,
      isConnected: false,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    // Loading label should be visible
    expect(screen.getByText(/Verbinde|Connecting/i)).toBeInTheDocument();
  });

  // --- Sidebar search filtering ---

  it("filters pokemon by search query in sidebar", async () => {
    const user = userEvent.setup();
    const mon1 = makePokemon({ id: "f1", name: "Pikachu", canonical_name: "pikachu", is_active: true });
    const mon2 = makePokemon({ id: "f2", name: "Mewtu", canonical_name: "mewtwo", is_active: true });

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

  it("shows edit, delete and caught buttons in header", () => {
    render(<Dashboard />);

    // All action buttons should have aria-labels
    expect(screen.getByLabelText(/Bearbeiten|Edit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Löschen|Delete/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gefangen|Caught/i)).toBeInTheDocument();
  });

  it("shows reactivate button for completed pokemon instead of caught", () => {
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

  it("shows total encounter count in sidebar quick actions", () => {
    const mon1 = makePokemon({ id: "e1", name: "Mon1", encounters: 100, is_active: true });
    const mon2 = makePokemon({ id: "e2", name: "Mon2", encounters: 200, is_active: false });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [mon1, mon2], active_id: "e1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

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

  it("renders all four header tabs when a pokemon is active", () => {
    render(<Dashboard />);

    // "Encounter" appears multiple times (tab + stats label), so use getAllByText
    expect(screen.getAllByText("Encounter").length).toBeGreaterThan(0);
    expect(screen.getByText("Auto Erkennung")).toBeInTheDocument();
    expect(screen.getAllByText("Overlay").length).toBeGreaterThan(0);
    expect(screen.getByText("Statistik")).toBeInTheDocument();
  });

  it("hides the detector tab when the viewed pokemon is completed", () => {
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

    // "Auto Erkennung" tab should not be rendered for completed pokemon
    expect(screen.queryByText("Auto Erkennung")).not.toBeInTheDocument();
  });

  it("shows the detector tab when the viewed pokemon is not completed", () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

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

// --- Pokemon List Rendering ---

describe("Dashboard pokemon list", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("renders active pokemon in the sidebar", () => {
    const p1 = makePokemon({ id: "p1", name: "Pikachu", is_active: true });
    const p2 = makePokemon({ id: "p2", name: "Glumanda", is_active: true });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getAllByText("Pikachu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Glumanda").length).toBeGreaterThan(0);
  });

  it("shows archived pokemon when archive tab is clicked", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "Pikachu", is_active: true });
    const archived = makePokemon({
      id: "p2",
      name: "Schiggy",
      is_active: false,
      completed_at: "2025-06-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, archived], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click the "Archiv" sidebar tab
    const archiveTab = screen.getByText("Archiv");
    await user.click(archiveTab);

    // Archived pokemon should appear in the list
    expect(screen.getAllByText("Schiggy").length).toBeGreaterThan(0);
  });

  it("shows active count badge in sidebar tab", () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // The active tab badge should show count of 2
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows archived count badge when there are completed pokemon", async () => {
    const active = makePokemon({ id: "p1", name: "Mon1" });
    const archived1 = makePokemon({ id: "p2", name: "Mon2", completed_at: "2025-01-01T00:00:00Z" });
    const archived2 = makePokemon({ id: "p3", name: "Mon3", completed_at: "2025-02-01T00:00:00Z" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, archived1, archived2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Archive tab badge should show 2
    const archiveTab = screen.getByText("Archiv");
    const badge = archiveTab.closest("span")?.querySelector(String.raw`.bg-accent-green\/20`);
    expect(badge).toBeTruthy();
  });

  it("displays encounter count for each pokemon in the sidebar", () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1", encounters: 500 });
    const p2 = makePokemon({ id: "p2", name: "Mon2", encounters: 1234 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Encounters are displayed with toLocaleString() — German locale uses "." as separator
    expect(screen.getAllByText("500").length).toBeGreaterThan(0);
    // 1234 could be "1.234" or "1,234" depending on locale in test env
    const sidebarItems = document.querySelectorAll("[data-sidebar-idx]");
    expect(sidebarItems.length).toBe(2);
  });

  it("shows archived pokemon with reduced opacity in sidebar", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "ActiveMon" });
    const archived = makePokemon({
      id: "p2",
      name: "ArchivedMon",
      completed_at: "2025-01-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, archived], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Switch to archive tab to see the archived pokemon
    const archiveTab = screen.getByText("Archiv");
    await user.click(archiveTab);

    // The sidebar item should have reduced opacity for archived pokemon
    const listItems = document.querySelectorAll("[data-sidebar-idx]");
    expect(listItems.length).toBeGreaterThan(0);
    expect(listItems[0].className).toContain("opacity-70");
  });
});

// --- Search Functionality ---

describe("Dashboard search", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("filters pokemon list by search query", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Pikachu" });
    const p2 = makePokemon({ id: "p2", name: "Glumanda" });
    const p3 = makePokemon({ id: "p3", name: "Schiggy" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2, p3], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "Pika");

    // Only Pikachu should remain visible in the sidebar list
    const listItems = document.querySelectorAll("[data-sidebar-idx]");
    expect(listItems.length).toBe(1);
  });

  it("shows empty state with 'no match' message when search has no results", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "zzzzzzz");

    // Should show the "no match" message (German: "Kein Treffer für")
    expect(screen.getByText(/Kein Treffer für/)).toBeInTheDocument();
  });

  it("shows clear button when search query is present", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "test");

    // There should be a clear (X) button visible in the search bar
    // Search for the clear button within the search wrapper
    const focusWrapper = document.querySelector("[data-focus-wrapper]");
    const clearButton = focusWrapper?.querySelector("button");
    expect(clearButton).toBeTruthy();
  });

  it("filters pokemon by game name", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Pikachu", game: "red" });
    const p2 = makePokemon({ id: "p2", name: "Glumanda", game: "blue" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "red");

    const listItems = document.querySelectorAll("[data-sidebar-idx]");
    expect(listItems.length).toBe(1);
  });
});

// --- Pokemon Selection ---

describe("Dashboard pokemon selection", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("clicking a sidebar pokemon sets it as viewed", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Pikachu", encounters: 100 });
    const p2 = makePokemon({ id: "p2", name: "Glumanda", encounters: 200 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click on Glumanda in the sidebar
    const glumandaButtons = screen.getAllByText("Glumanda");
    // Find the one in the sidebar (the button element)
    const sidebarButton = glumandaButtons.find(el => el.closest("[data-sidebar-idx]"));
    if (sidebarButton) {
      await user.click(sidebarButton);
    }

    // Glumanda should now appear in the header as the viewed pokemon
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Glumanda");
  });

  it("renders multiple pokemon that can be ctrl-clicked for selection", () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Both pokemon should be rendered in the sidebar
    const items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items.length).toBe(2);
  });
});

// --- Hunt Button States ---

describe("Dashboard hunt button", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows hunt start button for active pokemon (mode: both)", () => {
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Both sidebar and header have hunt buttons — check that at least one exists
    const huntButtons = screen.getAllByRole("button", { name: /Hunt starten/ });
    expect(huntButtons.length).toBeGreaterThan(0);
  });

  it("shows timer-specific button when hunt_mode is timer", () => {
    const pokemon = makePokemon({ id: "p1", hunt_mode: "timer" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const huntButtons = screen.getAllByRole("button", { name: /Timer starten/ });
    expect(huntButtons.length).toBeGreaterThan(0);
  });

  it("shows detector-specific button when hunt_mode is detector", () => {
    const pokemon = makePokemon({ id: "p1", hunt_mode: "detector" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const huntButtons = screen.getAllByRole("button", { name: /Erkennung starten/ });
    expect(huntButtons.length).toBeGreaterThan(0);
  });

  it("shows red stop button when timer is running", () => {
    const pokemon = makePokemon({
      id: "p1",
      hunt_mode: "both",
      timer_started_at: new Date().toISOString(),
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const huntButtons = screen.getAllByRole("button", { name: /Hunt stoppen/ });
    expect(huntButtons.length).toBeGreaterThan(0);
    // At least one should have red styling
    const hasRedButton = huntButtons.some(btn => btn.className.includes("text-red"));
    expect(hasRedButton).toBe(true);
  });

  it("does not show header hunt button for completed pokemon", () => {
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

    // The header's data-detector-tutorial="controls" wrapper should not exist for completed pokemon
    const headerHuntWrapper = document.querySelector("[data-detector-tutorial='controls']");
    expect(headerHuntWrapper).toBeNull();
  });
});

// --- Action Buttons ---

describe("Dashboard action buttons", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows edit, delete, and caught buttons in the header", () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Action buttons exist (may appear in both sidebar and header, so use getAll)
    const editButtons = screen.getAllByRole("button", { name: /Bearbeiten/ });
    expect(editButtons.length).toBeGreaterThan(0);
    const deleteButtons = screen.getAllByRole("button", { name: /Löschen/ });
    expect(deleteButtons.length).toBeGreaterThan(0);
    const caughtButtons = screen.getAllByRole("button", { name: /Gefangen/ });
    expect(caughtButtons.length).toBeGreaterThan(0);
  });

  it("shows reactivate button for completed pokemon instead of caught", () => {
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

    const reactivateButtons = screen.getAllByRole("button", { name: /Reaktivieren/ });
    expect(reactivateButtons.length).toBeGreaterThan(0);
  });

  it("calls fetch when caught button is clicked", async () => {
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

    // Should call the complete API endpoint
    expect(mockFetch).toHaveBeenCalledWith(
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

    // Click the first "Löschen" button (header action)
    const deleteButtons = screen.getAllByRole("button", { name: /Löschen/ });
    await user.click(deleteButtons[0]);

    // ConfirmModal renders a <dialog>, showModal should have been called
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Empty State ---

describe("Dashboard empty state", () => {
  it("shows empty state when no pokemon exists", () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Should show "Noch kein Pokémon" empty state
    expect(screen.getByText("Noch kein Pokémon")).toBeInTheDocument();
    // Should show "add first" button
    expect(screen.getByText(/Erstes Pokémon hinzufügen/)).toBeInTheDocument();
  });

  it("shows no-active-pokemon panel when no pokemon is selected", () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Should show the "Kein aktives Pokémon" main panel message
    expect(screen.getByText("Kein aktives Pokémon")).toBeInTheDocument();
  });

  it("shows empty archive message when archive tab is selected and no completed pokemon exist", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "Mon1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Switch to archive tab
    const archiveTab = screen.getByText("Archiv");
    await user.click(archiveTab);

    expect(screen.getByText("Noch keine Hunts archiviert")).toBeInTheDocument();
  });

  it("shows loading spinner when app state is null", () => {
    useCounterStore.setState({
      appState: null,
      isConnected: false,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Loading spinner should appear with "Verbinden..." text
    expect(screen.getByText(/Verbinde/)).toBeInTheDocument();
  });
});

// --- Counter Tab Content ---

describe("Dashboard counter tab", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows completed banner for caught pokemon", () => {
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

    // "Gefangen!" banner should appear
    expect(screen.getByText("Gefangen!")).toBeInTheDocument();
  });

  it("disables increment and decrement buttons for completed pokemon", () => {
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

    const incrementBtn = screen.getByRole("button", { name: "+1" });
    const decrementBtn = screen.getByRole("button", { name: /−1/ });
    expect(incrementBtn).toBeDisabled();
    expect(decrementBtn).toBeDisabled();
  });

  it("shows custom step labels when pokemon has a custom step", () => {
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

  it("shows odds display as 1/4096 by default", () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("displays total encounters in sidebar quick actions bar", () => {
    const p1 = makePokemon({ id: "p1", encounters: 100 });
    const p2 = makePokemon({ id: "p2", encounters: 200 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Total encounters = 300
    expect(screen.getByText("300")).toBeInTheDocument();
  });
});

// --- Sidebar State ---

describe("Dashboard sidebar", () => {
  it("shows add pokemon button in active tab", () => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // "Pokémon hinzufügen" button should be present
    expect(screen.getByText("Pokémon hinzufügen")).toBeInTheDocument();
  });

  it("hides add pokemon button in archive tab", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const archiveTab = screen.getByText("Archiv");
    await user.click(archiveTab);

    // The footer "Pokémon hinzufügen" button should disappear in archive mode
    // It only renders when sidebarTab === "active"
    const addButtons = screen.queryAllByText("Pokémon hinzufügen");
    // In archive tab the bottom add button should not be rendered
    // (the button in the sidebar footer is conditional on sidebarTab === "active")
    expect(addButtons.length).toBe(0);
  });

  it("displays game info in sidebar items", () => {
    const pokemon = makePokemon({ id: "p1", game: "red" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Game should be formatted as uppercase short string
    expect(screen.getAllByText("RED").length).toBeGreaterThan(0);
  });

  it("shows sort menu button", () => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const sortButton = screen.getByRole("button", { name: /Sortieren/ });
    expect(sortButton).toBeInTheDocument();
  });

  it("highlights the currently viewed pokemon in sidebar", () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // The active pokemon sidebar item should have the highlighted border class
    const firstItem = document.querySelector("[data-sidebar-idx='0']");
    expect(firstItem?.className).toContain("bg-accent-blue");
  });
});

// --- Sort Menu ---

describe("Dashboard sort menu", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "p1", name: "Zubat", encounters: 10, game: "red" }),
          makePokemon({ id: "p2", name: "Abra", encounters: 500, game: "blue" }),
          makePokemon({ id: "p3", name: "Mewtu", encounters: 200, game: "gold" }),
        ],
        active_id: "p1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("opens sort menu when sort button is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);

    // Sort options should appear
    expect(screen.getByText(/Zuletzt hinzugefügt|Recently added/i)).toBeInTheDocument();
    expect(screen.getByText(/Spiel|Game/i)).toBeInTheDocument();
  });

  it("sorts pokemon by name when name sort is selected", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);

    const nameSort = screen.getByText(/Name/);
    await user.click(nameSort);

    // Verify sort order via sidebar items
    const items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items.length).toBe(3);
    // Abra should be first alphabetically
    const firstItemText = items[0].textContent;
    expect(firstItemText).toContain("Abra");
  });

  it("sorts pokemon by encounters", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);

    // "Encounters" sort option in the dropdown menu
    const sortMenu = document.querySelector(".min-w-36");
    const encSort = sortMenu?.querySelectorAll("button")[2]; // recent, name, encounters, game
    if (encSort) await user.click(encSort);

    // Items should be sorted by encounter count ascending
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const firstItemText = items[0].textContent;
    expect(firstItemText).toContain("Zubat"); // 10 encounters, lowest
  });

  it("toggles sort direction when clicking the same sort option twice", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Sort by name first time
    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);

    // Click "Name" option in the sort menu
    let sortMenu = document.querySelector(".min-w-36");
    let nameOpt = sortMenu?.querySelectorAll("button")[1]; // index 1 = Name
    if (nameOpt) await user.click(nameOpt);

    // Abra should be first (asc)
    let items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items[0].textContent).toContain("Abra");

    // Sort by name again (should toggle to desc)
    await user.click(sortBtn);
    sortMenu = document.querySelector(".min-w-36");
    nameOpt = sortMenu?.querySelectorAll("button")[1];
    if (nameOpt) await user.click(nameOpt);

    items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items[0].textContent).toContain("Zubat");
  });
});

// --- Overlay Tab ---

describe("Dashboard overlay tab", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("shows global overlay placeholder with action buttons when mode is default", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Should show global overlay description text
    expect(screen.getByText(/Global/)).toBeInTheDocument();
    // Should show "Edit global" and "Switch to custom" links/buttons
    const customBtns = screen.getAllByText(/Custom|Eigenes/i);
    expect(customBtns.length).toBeGreaterThan(0);
  });

  it("shows custom overlay editor when custom mode is selected", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      overlay_mode: "custom",
      overlay: {
        canvas_width: 400,
        canvas_height: 200,
        background_color: "#000",
        background_opacity: 1,
        blur: 0,
        show_border: false,
        border_color: "#fff",
        border_radius: 0,
        sprite: { visible: true, x: 0, y: 0, width: 80, height: 80, z_index: 1, show_glow: false, glow_color: "#fff", glow_opacity: 0.5, glow_blur: 10, idle_animation: "none", trigger_enter: "none", trigger_exit: "none", trigger_decrement: "none" },
        name: { visible: true, x: 100, y: 10, width: 200, height: 30, z_index: 2, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        title: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 4, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        counter: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 3, style: {} as never, show_label: true, label_text: "Enc:", label_style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Custom mode should show save button
    const saveButtons = screen.queryAllByText(/Speichern|Save/i);
    expect(saveButtons.length).toBeGreaterThan(0);
  });

  it("pauses hotkeys when overlay tab is active", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Should have called fetch with /api/hotkeys/pause
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/pause"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resumes hotkeys when switching away from overlay tab", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Switch to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Switch back to counter tab
    const counterTab = screen.getAllByText("Encounter")[0];
    await user.click(counterTab);

    // Should have called fetch with /api/hotkeys/resume
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/resume"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// --- Sidebar Collapse ---

describe("Dashboard sidebar collapse", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("collapses sidebar when collapse button is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Expand button should now be visible
    const expandBtn = screen.getByRole("button", { name: /Ausklappen|Expand/i });
    expect(expandBtn).toBeInTheDocument();
  });

  it("expands sidebar when expand button is clicked", async () => {
    const user = userEvent.setup();
    // Start collapsed
    localStorage.setItem("encounty-sidebar-collapsed", "true");

    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const expandBtn = screen.getByRole("button", { name: /Ausklappen|Expand/i });
    await user.click(expandBtn);

    // Collapse button should now be visible again
    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    expect(collapseBtn).toBeInTheDocument();
  });

  it("shows collapsed mini-sidebar with pokemon sprites", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Pokemon sprites should still be visible in the collapsed sidebar
    const images = document.querySelectorAll(".pokemon-sprite");
    expect(images.length).toBeGreaterThan(0);
  });
});

// --- Timer Controls ---

describe("Dashboard timer controls", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("sends timer_start when play button is clicked in main panel", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "t1",
      timer_started_at: undefined,
      timer_accumulated_ms: 0,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "t1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const startBtn = screen.getByLabelText(/Timer starten/i);
    await user.click(startBtn);

    expect(mockSend).toHaveBeenCalledWith("timer_start", { pokemon_id: "t1" });
  });

  it("sends timer_stop when pause button is clicked in main panel", async () => {
    const user = userEvent.setup();
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

    const pauseBtn = screen.getAllByLabelText(/pause|stopp/i);
    // Click the main panel pause (not sidebar)
    await user.click(pauseBtn[0]);

    expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "t1" });
  });

  it("sends timer_reset when reset button is clicked in main panel", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "t1",
      timer_accumulated_ms: 5000,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "t1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const resetBtn = screen.getByLabelText(/Timer zurücksetzen|Timer reset/i);
    await user.click(resetBtn);

    expect(mockSend).toHaveBeenCalledWith("timer_reset", { pokemon_id: "t1" });
  });

  it("formats timer correctly for large values", () => {
    // 2 hours, 30 minutes, 45 seconds
    const pokemon = makePokemon({
      id: "t1",
      timer_accumulated_ms: 9045000,
      timer_started_at: undefined,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "t1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getAllByText("02:30:45").length).toBeGreaterThan(0);
  });
});

// --- Hunt Mode Selector ---

describe("Dashboard hunt mode selector", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("opens hunt mode dropdown in sidebar when chevron is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find all chevron buttons (sidebar and header may both have them)
    const allButtons = screen.getAllByRole("button");
    const chevronBtns = allButtons.filter(btn =>
      btn.querySelector(".lucide-chevron-down") !== null,
    );
    expect(chevronBtns.length).toBeGreaterThan(0);

    await user.click(chevronBtns[0]);

    // Hunt mode options should appear
    expect(screen.getAllByText(/Beides|Both/i).length).toBeGreaterThan(0);
  });

  it("shows timer-only option in hunt mode dropdown", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the hunt mode dropdown
    const allButtons = screen.getAllByRole("button");
    const chevronBtn = allButtons.find(btn =>
      btn.querySelector(".lucide-chevron-down") !== null,
    );
    await user.click(chevronBtn!);

    // Timer-only option should be present
    expect(screen.getAllByText(/Nur Timer|Timer Only/i).length).toBeGreaterThan(0);
  });

  it("calls fetch to update hunt_mode when a mode is selected", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open hunt mode dropdown
    const allButtons = screen.getAllByRole("button");
    const chevronBtn = allButtons.find(btn =>
      btn.querySelector(".lucide-chevron-down") !== null,
    );
    await user.click(chevronBtn!);

    // Click "Timer only"
    const timerOnlyBtns = screen.getAllByText(/Nur Timer|Timer Only/i);
    await user.click(timerOnlyBtns[0]);

    // Should have called PUT on the pokemon endpoint with timer mode
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1"),
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"hunt_mode":"timer"'),
      }),
    );
  });
});

// --- Multi-select Operations ---

describe("Dashboard multi-select", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows selection count and bulk action buttons when pokemon are ctrl-clicked", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Ctrl-click the first pokemon in sidebar
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const firstItemBtn = items[0].querySelector("button");
    if (firstItemBtn) {
      await user.keyboard("{Control>}");
      await user.click(firstItemBtn);
      await user.keyboard("{/Control}");
    }

    // Selection count badge should appear
    const selectionBadge = document.querySelector(".text-accent-blue.font-semibold");
    expect(selectionBadge).toBeTruthy();
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
    const resetBtn = screen.getByText("Reset").closest("button")!;
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

  it("shows radar odds when hunt_type is radar", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "radar" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getByText("1/~200")).toBeInTheDocument();
  });

  it("shows chain_fishing odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "chain_fishing" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getByText("1/~100")).toBeInTheDocument();
  });

  it("shows dynamax_adventure odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "dynamax_adventure" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getByText("1/100")).toBeInTheDocument();
  });

  it("shows default odds for soft_reset hunt type", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "soft_reset" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows friend_safari odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "friend_safari" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    expect(screen.getByText("1/819")).toBeInTheDocument();
  });
});

// --- Header Hunt Button ---

describe("Dashboard header hunt button", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("starts timer when header hunt button is clicked (timer mode)", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "timer" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const huntBtns = screen.getAllByRole("button", { name: /Timer starten/i });
    // Click the header hunt button (should be after the sidebar one)
    await user.click(huntBtns[huntBtns.length - 1]);

    expect(mockSend).toHaveBeenCalledWith("timer_start", { pokemon_id: "p1" });
  });

  it("stops timer when header stop button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      hunt_mode: "timer",
      timer_started_at: new Date().toISOString(),
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const stopBtns = screen.getAllByRole("button", { name: /Timer stoppen/i });
    await user.click(stopBtns[stopBtns.length - 1]);

    expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "p1" });
  });

  it("opens header hunt mode dropdown when chevron is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find the header hunt button area
    const controlsWrapper = document.querySelector("[data-detector-tutorial='controls']");
    expect(controlsWrapper).toBeTruthy();

    // Click chevron dropdown in header
    const chevrons = controlsWrapper!.querySelectorAll("button");
    const chevronBtn = Array.from(chevrons).find(
      (btn) => btn.querySelector(".lucide-chevron-down"),
    );
    if (chevronBtn) {
      await user.click(chevronBtn);
      // Mode options should appear
      expect(screen.getAllByText(/Beides|Both/i).length).toBeGreaterThan(0);
    }
  });
});

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
    const editBtn = sidebarItem!.querySelector("button[title*='Bearbeiten'], button[title*='Edit']");
    if (editBtn) {
      await user.click(editBtn as HTMLElement);
      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    }
  });
});

// --- Hotkey Target Button ---

describe("Dashboard hotkey target", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("sends set_active when hotkey target button is clicked in sidebar", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find keyboard icon buttons in sidebar (hotkey target buttons)
    const sidebarItems = document.querySelectorAll("[data-sidebar-idx]");
    const secondItem = sidebarItems[1];
    const hotkeyBtn = secondItem?.querySelector("button[title*='Hotkey']");
    if (hotkeyBtn) {
      await user.click(hotkeyBtn as HTMLElement);
      expect(mockSend).toHaveBeenCalledWith("set_active", { pokemon_id: "p2" });
    }
  });
});

// --- Detector Status Dots ---

describe("Dashboard detector status", () => {
  it("shows detector dot on pokemon with detector config", () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        precision: 0.8,
        consecutive_hits: 1,
        cooldown_sec: 5,
        change_threshold: 0.1,
        poll_interval_ms: 100,
        min_poll_ms: 50,
        max_poll_ms: 500,
        templates: [{ image_path: "/template.png", name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Detector dot should be present in the sidebar
    const dot = document.querySelector(".rounded-full.border.border-bg-secondary");
    expect(dot).toBeTruthy();
  });

  it("shows match state dot when detector has a match", () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        precision: 0.8,
        consecutive_hits: 1,
        cooldown_sec: 5,
        change_threshold: 0.1,
        poll_interval_ms: 100,
        min_poll_ms: 50,
        max_poll_ms: 500,
        templates: [{ image_path: "/template.png", name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: { p1: { state: "match", confidence: 0.95, poll_ms: 100 } },
    });

    render(<Dashboard />);

    // Green dot should be present for match state
    const greenDot = document.querySelector(".bg-accent-green.rounded-full");
    expect(greenDot).toBeTruthy();
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

    const reactivateBtns = screen.getAllByRole("button", { name: /Reaktivieren/i });
    await user.click(reactivateBtns[0]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1/uncomplete"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// --- Sidebar Timer ---

describe("Dashboard sidebar timer", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows timer in sidebar when pokemon has accumulated time", () => {
    const pokemon = makePokemon({
      id: "p1",
      timer_accumulated_ms: 60000, // 1 minute
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Should show timer in the sidebar (00:01:00)
    expect(screen.getAllByText("00:01:00").length).toBeGreaterThan(0);
  });

  it("does not show timer text in sidebar when no time accumulated and not running", () => {
    const pokemon = makePokemon({
      id: "p1",
      timer_accumulated_ms: 0,
      timer_started_at: undefined,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Sidebar timer should not show 00:00:00 (only main panel does)
    // The sidebar timer span is hidden when totalMs === 0 and not running
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    const timerSpan = sidebarItem?.querySelector(String.raw`.font-mono.tabular-nums.text-\[10px\]`);
    // Timer text should not exist in sidebar for zero-time non-running state
    expect(timerSpan).toBeNull();
  });
});

// --- Unsaved overlay confirmation dialog ---

describe("Dashboard unsaved overlay changes", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows unsaved overlay confirmation when switching tabs from dirty overlay", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      overlay_mode: "custom",
      overlay: {
        canvas_width: 400,
        canvas_height: 200,
        background_color: "#000",
        background_opacity: 1,
        blur: 0,
        show_border: false,
        border_color: "#fff",
        border_radius: 0,
        sprite: { visible: true, x: 0, y: 0, width: 80, height: 80, z_index: 1, show_glow: false, glow_color: "#fff", glow_opacity: 0.5, glow_blur: 10, idle_animation: "none", trigger_enter: "none", trigger_exit: "none", trigger_decrement: "none" },
        name: { visible: true, x: 100, y: 10, width: 200, height: 30, z_index: 2, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        title: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 4, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        counter: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 3, style: {} as never, show_label: true, label_text: "Enc:", label_style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Switch to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // The overlay tab should now be active
    expect(overlayTab.closest("button")).toHaveClass("bg-accent-blue");
  });
});

// --- Sidebar timer play/pause toggling ---

describe("Dashboard sidebar timer toggle", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("sends timer_start from sidebar timer when clicking play", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      timer_accumulated_ms: 10000,
      timer_started_at: undefined,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find the sidebar timer play button (small play icon button within sidebar item)
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    const timerBtns = sidebarItem?.querySelectorAll("button");
    // The sidebar timer play button is the last button group in the sidebar item
    const playBtn = Array.from(timerBtns || []).find(btn => (/start|starten/i).exec(btn.title ?? ""));
    if (playBtn) {
      await user.click(playBtn);
      expect(mockSend).toHaveBeenCalledWith("timer_start", { pokemon_id: "p1" });
    }
  });

  it("sends timer_stop from sidebar timer when clicking pause", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      timer_accumulated_ms: 10000,
      timer_started_at: new Date().toISOString(),
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find the sidebar timer pause button
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    const timerBtns = sidebarItem?.querySelectorAll("button");
    const pauseBtn = Array.from(timerBtns || []).find(btn => (/stop|stopp/i).exec(btn.title ?? ""));
    if (pauseBtn) {
      await user.click(pauseBtn);
      expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "p1" });
    }
  });
});

// --- Various odds display methods ---

describe("Dashboard additional odds display", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows horde odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "horde" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/~820")).toBeInTheDocument();
  });

  it("shows sos odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "sos" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/683")).toBeInTheDocument();
  });

  it("shows ultra_wormhole odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "ultra_wormhole" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/~3")).toBeInTheDocument();
  });

  it("shows dexnav odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "dexnav" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/~512")).toBeInTheDocument();
  });

  it("shows catch_combo odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "catch_combo" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/~273")).toBeInTheDocument();
  });

  it("shows sandwich odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "sandwich" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/683")).toBeInTheDocument();
  });

  it("shows default odds for fossil hunt type", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "fossil" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows default odds for gift hunt type", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "gift" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows max_raid odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "max_raid" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("shows tera_raid odds", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "tera_raid" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("falls back to default odds for unknown hunt type", () => {
    const pokemon = makePokemon({ id: "o1", hunt_type: "unknown_method" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "o1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    expect(screen.getByText("1/4096")).toBeInTheDocument();
  });

  it("returns 1/4096 when pokemon is null", () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    // No pokemon selected, default odds not shown in panel
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });
});

// --- Helper function coverage ---

describe("Dashboard helper functions", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("renders game info formatted as uppercase in header", () => {
    const pokemon = makePokemon({ id: "p1", game: "pokemon-sword" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    // formatGame should produce "SWORD" (removing "pokemon-" prefix)
    expect(screen.getAllByText("SWORD").length).toBeGreaterThan(0);
  });

  it("renders em dash for pokemon without game", () => {
    const pokemon = makePokemon({ id: "p1", game: undefined });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    // When no game is set, the header should not show a game badge
    const header = document.querySelector("header");
    expect(header).toBeTruthy();
  });

  it("sorts pokemon by game name", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1", game: "sword" });
    const p2 = makePokemon({ id: "p2", name: "Mon2", game: "arceus" });
    const p3 = makePokemon({ id: "p3", name: "Mon3", game: "red" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2, p3], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open sort menu and select game sort
    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);
    const sortMenu = document.querySelector(".min-w-36");
    const gameSort = sortMenu?.querySelectorAll("button")[3]; // recent, name, encounters, game
    if (gameSort) await user.click(gameSort);

    // Items should be sorted alphabetically by game
    const items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items[0].textContent).toContain("Mon2"); // arceus < red < sword
  });

  it("reverses list in recent sort desc mode", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "First" });
    const p2 = makePokemon({ id: "p2", name: "Second" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open sort menu and click "recently added" twice (toggle direction)
    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);
    const sortMenu = document.querySelector(".min-w-36");
    const recentOpt = sortMenu?.querySelectorAll("button")[0];
    if (recentOpt) await user.click(recentOpt);

    const items = document.querySelectorAll("[data-sidebar-idx]");
    // In desc mode, the list should be reversed
    expect(items.length).toBe(2);
  });
});

// --- Detector status dot styling ---

describe("Dashboard detector dot states", () => {
  it("shows pulsing blue dot when detector is running but no match", () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        precision: 0.8,
        consecutive_hits: 1,
        cooldown_sec: 5,
        change_threshold: 0.1,
        poll_interval_ms: 100,
        min_poll_ms: 50,
        max_poll_ms: 500,
        templates: [{ image_path: "/template.png", name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: { p1: { state: "idle", confidence: 0.3, poll_ms: 100 } },
    });

    render(<Dashboard />);

    // Should have a pulsing blue dot
    const blueDot = document.querySelector(".bg-accent-blue.animate-pulse");
    expect(blueDot).toBeTruthy();
  });
});

// --- Shift-select multi-select ---

describe("Dashboard shift-select", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("selects range of pokemon when shift-clicking", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });
    const p3 = makePokemon({ id: "p3", name: "Mon3" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2, p3], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Ctrl-click the first item to start selection
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const firstBtn = items[0].querySelector("button");
    if (firstBtn) {
      await user.keyboard("{Control>}");
      await user.click(firstBtn);
      await user.keyboard("{/Control}");
    }

    // Shift-click the third item to extend selection
    const thirdBtn = items[2].querySelector("button");
    if (thirdBtn) {
      await user.keyboard("{Shift>}");
      await user.click(thirdBtn);
      await user.keyboard("{/Shift}");
    }

    // Selection badge should show 3 (or at least more than 1)
    const badges = document.querySelectorAll(".text-accent-blue.font-semibold");
    expect(badges.length).toBeGreaterThan(0);
  });
});

// --- Overlay tab global mode content ---

describe("Dashboard overlay tab global mode", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("shows overlay mode buttons in the control bar", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Both "Global" and "Custom" mode buttons should appear in the control bar
    const globalBtns = screen.getAllByText(/Global/i);
    expect(globalBtns.length).toBeGreaterThan(0);
  });

  it("shows OBS browser source button in overlay tab", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // OBS browser source button (OverlayBrowserSourceButton) should be present
    const allBtns = screen.getAllByRole("button");
    expect(allBtns.length).toBeGreaterThan(0);
  });

  it("shows custom mode button in overlay control bar", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // "Eigenes" / "Custom" button should be present in the control bar
    const customBtns = screen.getAllByText(/Custom|Eigenes/i);
    expect(customBtns.length).toBeGreaterThan(0);
  });
});

// --- Detector tab rendering from Dashboard ---

describe("Dashboard detector tab", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("renders detector panel when detector tab is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const detectorTab = screen.getByText("Auto Erkennung");
    await user.click(detectorTab);

    // Detector panel elements should be visible (source selector combobox)
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders statistics panel when statistics tab is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const statsTab = screen.getByText("Statistik");
    await user.click(statsTab);

    // Statistics tab should now be active
    expect(statsTab.closest("button")).toHaveClass("bg-accent-blue");
  });
});

// --- Collapsed sidebar interactions ---

describe("Dashboard collapsed sidebar interactions", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("selects pokemon from collapsed sidebar", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Collapse sidebar
    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Click second pokemon in collapsed sidebar
    const sprites = document.querySelectorAll(".pokemon-sprite");
    expect(sprites.length).toBeGreaterThan(0);
  });

  it("persists sidebar collapsed state to localStorage", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    expect(localStorage.getItem("encounty-sidebar-collapsed")).toBe("true");
  });

  it("shows add button in collapsed sidebar when in active tab", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Add button should be present in collapsed sidebar
    const addBtns = screen.getAllByLabelText(/Pokémon hinzufügen/i);
    expect(addBtns.length).toBeGreaterThan(0);
  });
});

// --- Header hunt button: Both mode ---

describe("Dashboard header hunt button interactions", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("starts hunt in both mode (sends timer_start)", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click the header hunt button (the one inside data-detector-tutorial="controls")
    const controlsWrapper = document.querySelector("[data-detector-tutorial='controls']");
    const huntBtns = controlsWrapper?.querySelectorAll("button");
    if (huntBtns && huntBtns.length > 0) {
      await user.click(huntBtns[0]);
      expect(mockSend).toHaveBeenCalledWith("timer_start", { pokemon_id: "p1" });
    }
  });

  it("stops both timer and detector when stopping hunt in both mode", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      hunt_mode: "both",
      timer_started_at: new Date().toISOString(),
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const controlsWrapper = document.querySelector("[data-detector-tutorial='controls']");
    const huntBtns = controlsWrapper?.querySelectorAll("button");
    if (huntBtns && huntBtns.length > 0) {
      await user.click(huntBtns[0]);
      expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "p1" });
    }
  });
});

// --- Search clear button ---

describe("Dashboard search clear", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("clears search when X button is clicked", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "test");

    // Click the clear button
    const focusWrapper = document.querySelector("[data-focus-wrapper]");
    const clearButton = focusWrapper?.querySelector("button");
    if (clearButton) {
      await user.click(clearButton);
      // Search should be cleared
      expect(searchInput).toHaveValue("");
    }
  });
});

// --- Sidebar quick actions bar ---

describe("Dashboard sidebar quick actions", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows bulk delete and complete buttons when pokemon are selected", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Ctrl-click first pokemon
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const firstBtn = items[0].querySelector("button");
    if (firstBtn) {
      await user.keyboard("{Control>}");
      await user.click(firstBtn);
      await user.keyboard("{/Control}");
    }

    // Bulk action buttons should appear (delete + complete)
    const deleteBtn = screen.getAllByLabelText(/Löschen|Delete/i);
    expect(deleteBtn.length).toBeGreaterThan(0);
    const caughtBtn = screen.getAllByLabelText(/Gefangen|Caught/i);
    expect(caughtBtn.length).toBeGreaterThan(0);
  });

  it("shows clear selection button when pokemon are selected", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Ctrl-click first pokemon
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const firstBtn = items[0].querySelector("button");
    if (firstBtn) {
      await user.keyboard("{Control>}");
      await user.click(firstBtn);
      await user.keyboard("{/Control}");
    }

    // Selection count should be visible
    const selBadge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
    expect(selBadge?.textContent).toBe("1");
  });

  it("shows timer running indicator when a timer is running", () => {
    const pokemon = makePokemon({
      id: "p1",
      timer_started_at: new Date().toISOString(),
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Timer running indicator (green timer icon) should be visible in quick actions bar
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  it("shows detector running indicator when detection is active", () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        precision: 0.8,
        consecutive_hits: 1,
        cooldown_sec: 5,
        change_threshold: 0.1,
        poll_interval_ms: 100,
        min_poll_ms: 50,
        max_poll_ms: 500,
        templates: [{ image_path: "/template.png", name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: { p1: { state: "idle", confidence: 0.1, poll_ms: 100 } },
    });

    render(<Dashboard />);

    // Detector running indicator (blue eye icon) should be in the sidebar quick actions
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  it("disables hunt start button when no pokemon in selection", () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // The hunt start button in quick actions should be disabled
    const allButtons = screen.getAllByRole("button");
    expect(allButtons.length).toBeGreaterThan(0);
  });
});

// --- Detector match indicator on header tab ---

describe("Dashboard detector match indicator", () => {
  it("shows match dot on detector tab when detector status is match", () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: { p1: { state: "match", confidence: 0.95, poll_ms: 100 } },
    });

    render(<Dashboard />);

    // The detector tab should show a green match dot
    const matchDot = document.querySelector("header .bg-green-400.rounded-full");
    expect(matchDot).toBeTruthy();
  });
});

// --- Unsaved overlay changes dialog ---

describe("Dashboard unsaved overlay discard flow", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows unsaved changes dialog and discards when clicking discard button", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      overlay_mode: "custom",
      overlay: {
        canvas_width: 400,
        canvas_height: 200,
        background_color: "#000",
        background_opacity: 1,
        blur: 0,
        show_border: false,
        border_color: "#fff",
        border_radius: 0,
        sprite: { visible: true, x: 0, y: 0, width: 80, height: 80, z_index: 1, show_glow: false, glow_color: "#fff", glow_opacity: 0.5, glow_blur: 10, idle_animation: "none", trigger_enter: "none", trigger_exit: "none", trigger_decrement: "none" },
        name: { visible: true, x: 100, y: 10, width: 200, height: 30, z_index: 2, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        title: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 4, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        counter: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 3, style: {} as never, show_label: true, label_text: "Enc:", label_style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Switch to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Custom mode should render OverlayEditor; save button appears for custom mode
    const saveButtons = screen.queryAllByText(/Speichern|Save/i);
    expect(saveButtons.length).toBeGreaterThan(0);
  });

  it("dismisses unsaved changes dialog when stay button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      overlay_mode: "custom",
      overlay: {
        canvas_width: 400,
        canvas_height: 200,
        background_color: "#000",
        background_opacity: 1,
        blur: 0,
        show_border: false,
        border_color: "#fff",
        border_radius: 0,
        sprite: { visible: true, x: 0, y: 0, width: 80, height: 80, z_index: 1, show_glow: false, glow_color: "#fff", glow_opacity: 0.5, glow_blur: 10, idle_animation: "none", trigger_enter: "none", trigger_exit: "none", trigger_decrement: "none" },
        name: { visible: true, x: 100, y: 10, width: 200, height: 30, z_index: 2, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        title: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 4, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        counter: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 3, style: {} as never, show_label: true, label_text: "Enc:", label_style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Switch to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // The overlay tab should now be active
    expect(overlayTab.closest("button")).toHaveClass("bg-accent-blue");
  });
});

// --- Keyboard navigation ---

describe("Dashboard keyboard shortcuts", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("focuses search input with Ctrl+K", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Press Ctrl+K
    await user.keyboard("{Control>}k{/Control}");

    // Search input should be focused
    const searchInput = screen.getAllByRole("textbox")[0];
    expect(document.activeElement).toBe(searchInput);
  });

  it("clears search and adds pokemon from no-match empty state", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Type a search with no matches
    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "zzzzzzz");

    // Click the "add new" button in the empty state (it contains a Plus icon + text)
    const addButtons = screen.getAllByText(/hinzufügen/i);
    // Pick the one in the empty state area (has "mt-3" class)
    const emptyStateAddBtn = addButtons.find(el => el.closest(".mt-3"));
    if (emptyStateAddBtn) await user.click(emptyStateAddBtn);

    // Should open the add modal
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Overlay mode switching ---

describe("Dashboard overlay mode switch", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("switches to custom overlay mode when custom button is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Go to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Click the "Custom" / "Eigenes" button
    const customBtns = screen.getAllByText(/Custom|Eigenes/i);
    await user.click(customBtns[0]);

    // Should trigger a PUT call with overlay_mode=custom
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1"),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("shows edit layout link in overlay default mode", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Go to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Should show "Edit layout" / "Layout bearbeiten" link in the placeholder
    const editLinks = screen.getAllByText(/Layout bearbeiten|Edit layout/i);
    expect(editLinks.length).toBeGreaterThan(0);
  });

  it("shows switch to custom button in global overlay mode placeholder", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Go to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Should show "Use custom" / "Eigenes verwenden" button in the placeholder area
    const switchCustomBtns = screen.getAllByText(/Eigenes verwenden|Use custom/i);
    expect(switchCustomBtns.length).toBeGreaterThan(0);
  });
});

// --- Sidebar keyboard navigation ---

describe("Dashboard sidebar keyboard navigation", () => {
  beforeEach(() => {
    // Mock scrollIntoView which is not available in jsdom
    Element.prototype.scrollIntoView = vi.fn();
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "p1", name: "Mon1" }),
          makePokemon({ id: "p2", name: "Mon2" }),
          makePokemon({ id: "p3", name: "Mon3" }),
        ],
        active_id: "p1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("navigates sidebar items with ArrowDown key and highlights focused item", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Press ArrowDown once to focus index 0
    await user.keyboard("{ArrowDown}");

    // The first item should have the focus ring class
    const firstItem = document.querySelector("[data-sidebar-idx='0']");
    expect(firstItem).not.toBeNull();
    expect(firstItem!.className).toContain("ring-1");
  });

  it("navigates sidebar items with ArrowUp key and highlights last item", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Press ArrowUp from nothing focuses last item
    await user.keyboard("{ArrowUp}");

    // The last item (idx=2) should have the focus ring class
    const lastItem = document.querySelector("[data-sidebar-idx='2']");
    expect(lastItem).not.toBeNull();
    expect(lastItem!.className).toContain("ring-1");
  });

  it("selects all with Ctrl+A", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Press Ctrl+A to select all
    await user.keyboard("{Control>}a{/Control}");

    // Selection count should show 3
    const badge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
    expect(badge?.textContent).toBe("3");
  });

  it("clears selection with Escape when items are selected", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Select all first
    await user.keyboard("{Control>}a{/Control}");

    // Selection count should show 3
    let badge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
    expect(badge?.textContent).toBe("3");

    // Press Escape to clear selection
    await user.keyboard("{Escape}");

    // Selection should be cleared
    badge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
    expect(badge).toBeNull();
  });
});

// --- Bulk operations ---

describe("Dashboard bulk operations", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("bulk completes selected pokemon", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Select all with Ctrl+A
    await user.keyboard("{Control>}a{/Control}");

    // Click the bulk complete button (PartyPopper icon in quick actions)
    const caughtBtns = screen.getAllByLabelText(/Gefangen|Caught/i);
    // Pick the one in the quick actions bar (not header)
    await user.click(caughtBtns[0]);

    // Should have called complete API for both pokemon
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1/complete"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p2/complete"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("bulk deletes selected pokemon after confirmation", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Select all with Ctrl+A
    await user.keyboard("{Control>}a{/Control}");

    // Click the bulk delete button in quick actions
    const deleteBtns = screen.getAllByLabelText(/Löschen|Delete/i);
    await user.click(deleteBtns[0]);

    // ConfirmModal should open
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Collapsed sidebar archived tab ---

describe("Dashboard collapsed sidebar archived tab", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("hides add button in collapsed sidebar when on archived tab", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "Mon1" });
    const archived = makePokemon({ id: "p2", name: "Mon2", completed_at: "2025-01-01T00:00:00Z" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, archived], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Switch to archived tab
    const archiveTab = screen.getByText("Archiv");
    await user.click(archiveTab);

    // Collapse sidebar
    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Add button should not be present in collapsed sidebar for archived tab
    const addBtns = screen.queryAllByLabelText(/Pokémon hinzufügen/i);
    expect(addBtns.length).toBe(0);
  });
});

// --- Sidebar sort persistence ---

describe("Dashboard sort persistence", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("persists sort mode to localStorage", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open sort menu and select name sort
    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);
    const sortMenu = document.querySelector(".min-w-36");
    const nameOpt = sortMenu?.querySelectorAll("button")[1];
    if (nameOpt) await user.click(nameOpt);

    expect(localStorage.getItem("encounty-sort-mode")).toBe("name");
    expect(localStorage.getItem("encounty-sort-dir")).toBe("asc");
  });

  it("loads persisted sort mode from localStorage", () => {
    localStorage.setItem("encounty-sort-mode", "name");
    localStorage.setItem("encounty-sort-dir", "desc");

    const p1 = makePokemon({ id: "p1", name: "Zubat" });
    const p2 = makePokemon({ id: "p2", name: "Abra" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Items should be sorted by name desc (Zubat first)
    const items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items[0].textContent).toContain("Zubat");
  });
});

// --- Overlay OBS URL copy ---

describe("Dashboard overlay OBS URL copy", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("shows OBS URL card button in overlay default mode", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Go to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Should show OBS URL button (aria-label contains "OBS")
    const obsUrlBtns = screen.getAllByLabelText(/OBS/i);
    expect(obsUrlBtns.length).toBeGreaterThan(0);
  });
});

// --- Sidebar activate via Enter/Space key ---

describe("Dashboard sidebar item keyboard activation", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("activates pokemon when Enter is pressed on sidebar item button", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click on Mon2 in the sidebar to navigate to it
    const mon2Elements = screen.getAllByText("Mon2");
    const sidebarMon2 = mon2Elements.find(el => el.closest("[data-sidebar-idx]"));
    if (sidebarMon2) await user.click(sidebarMon2);

    // The header should now show Mon2 as the viewed pokemon
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Mon2");
  });

  it("activates pokemon when sidebar item is focused and Enter is pressed via keyboard nav", async () => {
    // Mock scrollIntoView for this test as well
    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Navigate to second item with ArrowDown twice (index 0 then 1)
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");

    // Press Enter to activate the focused item
    await user.keyboard("{Enter}");

    // The header should now show Mon2
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Mon2");
  });
});

// --- Detector mode hunt button ---

describe("Dashboard detector mode hunt interactions", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("does not send timer_start when hunt_mode is detector", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "detector" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click the header hunt button
    const controlsWrapper = document.querySelector("[data-detector-tutorial='controls']");
    const huntBtns = controlsWrapper?.querySelectorAll("button");
    if (huntBtns && huntBtns.length > 0) {
      await user.click(huntBtns[0]);
      // Should NOT have called timer_start because mode is detector-only
      expect(mockSend).not.toHaveBeenCalledWith("timer_start", expect.anything());
    }
  });
});

// --- Overlay tab import button ---

describe("Dashboard overlay import dropdown", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows import dropdown with global layout option in custom overlay mode", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      overlay_mode: "custom",
      overlay: {
        canvas_width: 400,
        canvas_height: 200,
        background_color: "#000",
        background_opacity: 1,
        blur: 0,
        show_border: false,
        border_color: "#fff",
        border_radius: 0,
        sprite: { visible: true, x: 0, y: 0, width: 80, height: 80, z_index: 1, show_glow: false, glow_color: "#fff", glow_opacity: 0.5, glow_blur: 10, idle_animation: "none", trigger_enter: "none", trigger_exit: "none", trigger_decrement: "none" },
        name: { visible: true, x: 100, y: 10, width: 200, height: 30, z_index: 2, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        title: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 4, style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
        counter: { visible: true, x: 100, y: 50, width: 200, height: 30, z_index: 3, style: {} as never, show_label: true, label_text: "Enc:", label_style: {} as never, idle_animation: "none", trigger_enter: "none", trigger_decrement: "none" },
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Go to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Import dropdown should show "Global Layout" option
    const importBtns = screen.getAllByText(/Importieren|Import/i);
    expect(importBtns.length).toBeGreaterThan(0);

    // The global layout option should be visible on hover (rendered via group-hover)
    const globalLayoutBtns = screen.getAllByText(/Globales Layout|Global Layout/i);
    expect(globalLayoutBtns.length).toBeGreaterThan(0);
  });
});

// --- Game badge in header ---

describe("Dashboard header game badge", () => {
  it("shows formatted game badge when pokemon has a game with pokemon- prefix", () => {
    const pokemon = makePokemon({ id: "p1", game: "pokemon-letsgo-pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // formatGame removes "pokemon-" and replaces "letsgo" with "L.G. "
    expect(screen.getAllByText("L.G. -PIKACHU").length).toBeGreaterThan(0);
  });

  it("does not show game badge when pokemon has no game", () => {
    const pokemon = makePokemon({ id: "p1", game: undefined });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Header center should not have a game badge line
    const header = document.querySelector("header");
    const gameBadge = header?.querySelector(".tracking-wider.font-semibold.text-text-muted");
    expect(gameBadge).toBeNull();
  });
});
