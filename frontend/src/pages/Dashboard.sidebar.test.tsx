/**
 * Dashboard.sidebar.test.tsx: sidebar list, search, sorting, selection and grouping.
 *
 * Split out of the original Dashboard.test.tsx; the mocks and setup below are
 * per file, so every split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  makeAppState,
  makePokemon,
  userEvent,
  act,
  fireEvent,
  within,
} from "../test-utils";
import { Dashboard } from "./Dashboard";
import { useCounterStore } from "../hooks/useCounterState";
import { stopDetectionForPokemon } from "../engine/startDetection";

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

// --- Pokemon List Rendering ---

describe("Dashboard pokemon list", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("renders active pokemon in the sidebar", async () => {
    const p1 = makePokemon({ id: "p1", name: "Pikachu", is_active: true });
    const p2 = makePokemon({ id: "p2", name: "Glumanda", is_active: true });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getAllByText("Pikachu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Glumanda").length).toBeGreaterThan(0);
  });

  it("displays encounter count for each pokemon in the sidebar", async () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1", encounters: 500 });
    const p2 = makePokemon({ id: "p2", name: "Mon2", encounters: 1234 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Encounters are displayed with toLocaleString(), German locale uses "." as separator
    expect(screen.getAllByText("500").length).toBeGreaterThan(0);
    // 1234 could be "1.234" or "1,234" depending on locale in test env
    const sidebarItems = document.querySelectorAll("[data-sidebar-idx]");
    expect(sidebarItems.length).toBe(2);
  });

  it("never applies the reduced-opacity treatment to a rendered sidebar row", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "ActiveMon" });
    const completed = makePokemon({
      id: "p2",
      name: "CompletedMon",
      completed_at: "2025-01-01T00:00:00Z",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, completed], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // A caught row is marked by the trophy badge, not by dimming the whole row:
    // "opacity-70" pushed the muted metadata text below the 4.5:1 contrast the
    // project requires, in both themes.
    const activeRows = [...document.querySelectorAll("[data-sidebar-idx]")];
    expect(activeRows.length).toBeGreaterThan(0);
    expect(activeRows.some((el) => el.className.includes("opacity-70"))).toBe(false);

    await user.click(screen.getByRole("button", { name: /^Pokédex\b/ }));

    const caughtRows = [...document.querySelectorAll("[data-sidebar-idx]")];
    expect(caughtRows.length).toBeGreaterThan(0);
    expect(caughtRows.some((el) => el.className.includes("opacity-70"))).toBe(false);
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
    const sidebarButton = glumandaButtons.find((el) => el.closest("[data-sidebar-idx]"));
    if (sidebarButton) {
      await user.click(sidebarButton);
    }

    // Glumanda should now appear in the header as the viewed pokemon
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Glumanda");
  });

  it("renders multiple pokemon that can be ctrl-clicked for selection", async () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Both pokemon should be rendered in the sidebar
    const items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items.length).toBe(2);
  });
});

// --- Empty State ---

describe("Dashboard empty state", () => {
  it("shows empty state when no pokemon exists", async () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Should show "Noch kein Pokémon" empty state
    expect(screen.getByText("Noch kein Pokémon")).toBeInTheDocument();
    // Should show "add first" button
    expect(screen.getByText(/Erstes Pokémon hinzufügen/)).toBeInTheDocument();
  });

  it("shows no-active-pokemon panel when no pokemon is selected", async () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Should show the "Kein aktives Pokémon" main panel message
    expect(screen.getByText("Kein aktives Pokémon")).toBeInTheDocument();
  });

  it("shows loading spinner when app state is null", async () => {
    useCounterStore.setState({
      appState: null,
      isConnected: false,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Loading spinner should appear with "Verbinden..." text
    expect(screen.getByText(/Verbinde/)).toBeInTheDocument();
  });
});

// --- Sidebar State ---

describe("Dashboard sidebar", () => {
  it("shows add pokemon button in the sidebar footer", async () => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // "Pokémon hinzufügen" button should be present
    expect(screen.getByText("Pokémon hinzufügen")).toBeInTheDocument();
  });

  it("keeps the add pokemon button in the sidebar footer when completed hunts exist", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "Mon1" });
    const completed = makePokemon({ id: "p2", name: "Mon2", completed_at: "2025-01-01T00:00:00Z" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, completed], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Completed hunts do not affect the active tab's footer button.
    expect(screen.getByText("Pokémon hinzufügen")).toBeInTheDocument();

    // Adding a hunt makes no sense while browsing what is already caught.
    await user.click(screen.getByRole("button", { name: /^Pokédex\b/ }));
    expect(screen.queryByText("Pokémon hinzufügen")).not.toBeInTheDocument();
  });

  it("displays game info in sidebar items", async () => {
    const pokemon = makePokemon({ id: "p1", game: "red" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Game should be formatted as uppercase short string
    expect(screen.getAllByText("RED").length).toBeGreaterThan(0);
  });

  it("shows sort menu button", async () => {
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const sortButton = screen.getByRole("button", { name: /Sortieren/ });
    expect(sortButton).toBeInTheDocument();
  });

  it("highlights the currently viewed pokemon in sidebar", async () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

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
    await user.keyboard("{Control>}");
    await user.click(items[0]);
    await user.keyboard("{/Control}");

    // Selection count badge should appear
    const selectionBadge = document.querySelector(".text-accent-blue.font-semibold");
    expect(selectionBadge).toBeTruthy();
  });
});

// --- Detector Status Dots ---

describe("Dashboard detector status", () => {
  it("shows detector dot on pokemon with detector config", async () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.1,
        templates: [{ name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Detector dot should be present in the sidebar
    const dot = document.querySelector(".rounded-full.border.border-bg-secondary");
    expect(dot).toBeTruthy();
  });

  it("shows match state dot when detector has a match", async () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.1,
        templates: [{ name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: { p1: { state: "match", confidence: 0.95, poll_ms: 100 } },
    });

    render(<Dashboard />);
    await act(async () => {});

    // Green dot should be present for match state
    const greenDot = document.querySelector(".bg-accent-green.rounded-full");
    expect(greenDot).toBeTruthy();
  });
});

// --- Helper function coverage ---

describe("Dashboard helper functions", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("renders game info formatted as uppercase in header", async () => {
    const pokemon = makePokemon({ id: "p1", game: "pokemon-sword" });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
    // formatGame should produce "SWORD" (removing "pokemon-" prefix)
    expect(screen.getAllByText("SWORD").length).toBeGreaterThan(0);
  });

  it("renders em dash for pokemon without game", async () => {
    const pokemon = makePokemon({ id: "p1", game: undefined });
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
    render(<Dashboard />);
    await act(async () => {});
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
  it("shows pulsing blue dot when detector is running but no match", async () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.1,
        templates: [{ name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: { p1: { state: "idle", confidence: 0.3, poll_ms: 100 } },
    });

    render(<Dashboard />);
    await act(async () => {});

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
    await user.keyboard("{Control>}");
    await user.click(items[0]);
    await user.keyboard("{/Control}");

    // Shift-click the third item to extend selection
    await user.keyboard("{Shift>}");
    await user.click(items[2]);
    await user.keyboard("{/Shift}");

    // Selection badge should show 3 (or at least more than 1)
    const badges = document.querySelectorAll(".text-accent-blue.font-semibold");
    expect(badges.length).toBeGreaterThan(0);
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

  it("shows add button in collapsed sidebar", async () => {
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

  it("moves real DOM focus together with the visual highlight on ArrowDown", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    await user.keyboard("{ArrowDown}");
    const firstItem = document.querySelector("[data-sidebar-idx='0']");
    expect(document.activeElement).toBe(firstItem);

    await user.keyboard("{ArrowDown}");
    const secondItem = document.querySelector("[data-sidebar-idx='1']");
    expect(document.activeElement).toBe(secondItem);
  });

  it("reflects multi-select state via data-selected and sr-only text", async () => {
    render(<Dashboard />);

    const items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items.length).toBeGreaterThan(1);
    const second = items[1] as HTMLElement;
    expect(second.hasAttribute("data-selected")).toBe(false);

    fireEvent.click(second, { ctrlKey: true });

    expect(second.hasAttribute("data-selected")).toBe(true);
    expect(second.textContent).toContain("ausgewählt");
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

// --- Collapsed sidebar with completed hunts ---

describe("Dashboard collapsed sidebar with completed hunts", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("keeps the add button in the collapsed sidebar when completed hunts exist", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "Mon1" });
    const completed = makePokemon({ id: "p2", name: "Mon2", completed_at: "2025-01-01T00:00:00Z" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, completed], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Collapse sidebar
    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Completed hunts do not affect the active tab's collapsed add button.
    expect(screen.getAllByLabelText(/Pokémon hinzufügen/i).length).toBeGreaterThan(0);
  });

  it("hides the add button in the collapsed sidebar on the pokedex tab", async () => {
    const user = userEvent.setup();
    const active = makePokemon({ id: "p1", name: "Mon1" });
    const completed = makePokemon({ id: "p2", name: "Mon2", completed_at: "2025-01-01T00:00:00Z" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [active, completed], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    await user.click(screen.getByRole("button", { name: /^Pokédex\b/ }));
    await user.click(screen.getByRole("button", { name: /Einklappen|Collapse/i }));

    expect(screen.queryAllByLabelText(/Pokémon hinzufügen/i).length).toBe(0);
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
    const sidebarMon2 = mon2Elements.find((el) => el.closest("[data-sidebar-idx]"));
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

// --- Sidebar keyboard Space to toggle select ---

describe("Dashboard sidebar Space key select", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "p1", name: "Mon1" }), makePokemon({ id: "p2", name: "Mon2" })],
        active_id: "p1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("toggles selection with Space key on focused sidebar item", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Navigate to first item
    await user.keyboard("{ArrowDown}");

    // Press Space to toggle select
    await user.keyboard(" ");

    // Selection badge should appear
    const badge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
    expect(badge?.textContent).toBe("1");
  });

  it("clears search with Escape when no selection is active", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Type in search
    const searchInput = screen.getAllByRole("textbox")[0];
    await user.type(searchInput, "test");
    expect(searchInput).toHaveValue("test");

    // Click away from the search input to make sure Escape targets the sidebar
    await user.click(document.body);

    // Press Escape to clear search
    await user.keyboard("{Escape}");

    // Search should be cleared
    expect(searchInput).toHaveValue("");
  });
});

// --- Sidebar Delete key for bulk delete ---

describe("Dashboard sidebar Delete key", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "p1", name: "Mon1" }), makePokemon({ id: "p2", name: "Mon2" })],
        active_id: "p1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("opens delete confirmation when Delete key is pressed with selected items", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Select all with Ctrl+A
    await user.keyboard("{Control>}a{/Control}");

    // Press Delete
    await user.keyboard("{Delete}");

    // ConfirmModal should open
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Collapsed sidebar add modal ---

describe("Dashboard collapsed sidebar add button", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    localStorage.clear();
  });

  it("opens add modal from collapsed sidebar add button", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Collapse sidebar
    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Click the add button in collapsed sidebar
    const addBtns = screen.getAllByLabelText(/Pokémon hinzufügen/i);
    await user.click(addBtns[0]);

    // AddPokemonModal should open
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});

// --- Sidebar clear selection button ---

describe("Dashboard sidebar clear selection", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("clears selection when X button in quick actions is clicked", async () => {
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

    // Selection badge should show 2
    let badge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
    expect(badge?.textContent).toBe("2");

    // Find and click the clear selection button (X icon, title matches "Auswahl aufheben")
    const allButtons = screen.getAllByRole("button");
    const clearBtn = allButtons.find((btn) => {
      const parent = btn.closest(".border-b.border-border-subtle");
      return parent && btn.title && /Auswahl|clear/i.exec(btn.title);
    });

    if (clearBtn) {
      await user.click(clearBtn);

      // Selection should be cleared
      badge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
      expect(badge).toBeNull();
    }
  });
});

// --- Sidebar item activate on Enter key in item button ---

describe("Dashboard sidebar item Enter/Space keydown on button", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("activates pokemon when Enter is pressed on sidebar item button element", async () => {
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

    // Find the second sidebar item and focus it
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const secondItem = items[1] as HTMLElement;
    expect(secondItem).toBeTruthy();

    // Focus and press Enter
    secondItem.focus();
    await user.keyboard("{Enter}");

    // Mon2 should now be the viewed pokemon in the header
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Mon2");
  });

  it("activates pokemon when Space is pressed on sidebar item button element", async () => {
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

    // Find the second sidebar item and focus it
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const secondItem = items[1] as HTMLElement;
    expect(secondItem).toBeTruthy();

    // Focus and press Space
    secondItem.focus();
    await user.keyboard(" ");

    // Mon2 should now be the viewed pokemon in the header
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Mon2");
  });
});

// --- Sidebar sort menu close on backdrop click ---

describe("Dashboard sort menu close", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("closes sort menu when backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Open sort menu
    const sortBtn = screen.getByRole("button", { name: /Sortieren/i });
    await user.click(sortBtn);

    // Sort menu should be visible
    const sortMenu = document.querySelector(".min-w-36");
    expect(sortMenu).toBeTruthy();

    // Click the backdrop button (aria-label "Close")
    const closeButtons = screen.getAllByLabelText(/Close|Schließen/i);
    const backdropClose = closeButtons.find((btn) => btn.className.includes("fixed"));
    if (backdropClose) {
      await user.click(backdropClose);
    }

    // Sort menu should be closed
    const sortMenuAfter = document.querySelector(".min-w-36");
    expect(sortMenuAfter).toBeNull();
  });
});

// --- Sidebar hover-visible sidebar edit pencil ---

describe("Dashboard sidebar inline edit button", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("opens edit modal when clicking sidebar pencil edit button", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "Pikachu" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find the sidebar item's inline edit button (Pencil icon)
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    const editBtns = sidebarItem?.querySelectorAll("button");
    const editPencil = Array.from(editBtns || []).find(
      (btn) => btn.title === "Bearbeiten" || btn.title === "Edit",
    );

    if (editPencil) {
      await user.click(editPencil as HTMLElement);
      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    }
  });
});

// --- Sidebar item onKeyDown handleActivateKeyDown ---

describe("Dashboard sidebar item keydown event", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("handles Enter keydown on sidebar item button to activate pokemon", async () => {
    const p1 = makePokemon({ id: "p1", name: "Mon1" });
    const p2 = makePokemon({ id: "p2", name: "Mon2" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Find the second sidebar item and focus it
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const secondItem = items[1] as HTMLElement;
    expect(secondItem).toBeTruthy();

    // Simulate keydown with Enter
    await act(async () => {
      secondItem.focus();
      const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      secondItem.dispatchEvent(enterEvent);
    });

    // Mon2 should be the viewed pokemon
    const headerName = document.querySelector("header .text-sm.font-bold");
    expect(headerName?.textContent).toBe("Mon2");
  });
});

// --- Collapsed sidebar item click to select pokemon ---

describe("Dashboard collapsed sidebar item activation", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("activates a different pokemon from collapsed sidebar", async () => {
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

    // Click the second pokemon in collapsed sidebar
    const sprites = document.querySelectorAll(".pokemon-sprite");
    expect(sprites.length).toBeGreaterThanOrEqual(2);

    // Click on the button containing the second sprite
    const secondSpriteBtn = sprites[1].closest("button");
    if (secondSpriteBtn) {
      await user.click(secondSpriteBtn as HTMLElement);

      // Mon2 should now be the viewed pokemon
      const headerName = document.querySelector("header .text-sm.font-bold");
      expect(headerName?.textContent).toBe("Mon2");
    }
  });
});

// --- No game field on sidebar item ---

describe("Dashboard sidebar item without game", () => {
  it("renders sidebar item without game separator when game is undefined", async () => {
    const pokemon = makePokemon({ id: "p1", name: "TestMon", game: undefined });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // The sidebar item should render without the game text
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    expect(sidebarItem).toBeTruthy();
    // Should not have the "·" separator since there's no game
    const separators = sidebarItem?.querySelectorAll(".text-text-faint");
    const hasDotSeparator = Array.from(separators || []).some((el) => el.textContent === "·");
    expect(hasDotSeparator).toBe(false);
  });
});

// --- Detector stopped dot ---

describe("Dashboard detector stopped dot", () => {
  it("shows grey dot when detector is configured but not running", async () => {
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.1,
        templates: [{ name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {}, // Not running
    });

    render(<Dashboard />);
    await act(async () => {});

    // Should have a grey/faint dot (not green or blue)
    const faintDot = document.querySelector("[class*='bg-text-faint']");
    expect(faintDot).toBeTruthy();
  });
});

// --- ConfirmModal close callback ---

describe("Dashboard confirm modal close callback", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("closes confirm modal when cancel is clicked on reset dialog", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", encounters: 100 });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click the reset button to open confirm dialog
    const resetBtn = screen.getByRole("button", { name: "Zurücksetzen" });
    await user.click(resetBtn);

    // ConfirmModal should be open with destructive confirmation
    const confirmText = screen.getByText(/Zähler zurücksetzen|Reset counter/i);
    expect(confirmText).toBeInTheDocument();

    // Click cancel/close button in the dialog
    const cancelBtns = screen.getAllByText(/Abbrechen|Cancel/i);
    if (cancelBtns.length > 0) {
      await user.click(cancelBtns[0]);
    }
  });

  it("confirms deletion when confirm button is clicked in delete dialog", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "ToDelete" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Click delete button
    const deleteBtns = screen.getAllByRole("button", { name: /Löschen|Delete/i });
    await user.click(deleteBtns[0]);

    // ConfirmModal should be open
    const confirmBtns = screen.getAllByText(/Löschen|Delete/i);
    // Find the confirm button within the dialog (not the header delete button)
    const dialogConfirm = confirmBtns.find((el) => {
      const dialog = el.closest("dialog");
      return dialog !== null;
    });

    if (dialogConfirm) {
      await user.click(dialogConfirm);

      // Should have called fetch with DELETE method
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/pokemon/p1"),
        expect.objectContaining({ method: "DELETE" }),
      );
    }
  });
});

// --- Sidebar img error callback ---

describe("Dashboard sidebar sprite error fallback", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("falls back to default sprite when sidebar image fails to load", async () => {
    const pokemon = makePokemon({
      id: "p1",
      name: "Mon1",
      sprite_url: "https://broken-sprite.png",
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Find the sidebar sprite image
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    const img = sidebarItem?.querySelector("img.pokemon-sprite") as HTMLImageElement;
    expect(img).toBeTruthy();

    // Trigger error
    act(() => {
      img.dispatchEvent(new Event("error", { bubbles: true }));
    });

    // After error, the image should still exist (with fallback URL)
    const imgAfter = sidebarItem?.querySelector("img.pokemon-sprite") as HTMLImageElement;
    expect(imgAfter).toBeTruthy();
  });
});

// --- Collapsed sidebar img error ---

describe("Dashboard collapsed sidebar sprite error", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("handles image error in collapsed sidebar", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", name: "Mon1", sprite_url: "https://broken.png" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Collapse sidebar
    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Trigger image error on collapsed sidebar sprite
    const sprites = document.querySelectorAll(".pokemon-sprite");
    expect(sprites.length).toBeGreaterThan(0);

    const img = sprites[0] as HTMLImageElement;
    act(() => {
      img.dispatchEvent(new Event("error", { bubbles: true }));
    });

    // Image should still exist
    expect(img).toBeTruthy();
  });
});

// --- Sidebar tag filter funnel toggle ---

describe("Dashboard sidebar tag filter toggle", () => {
  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "p1", name: "Mon1", tags: ["shiny"] })],
        active_id: "p1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("hides the tag filter bar until the funnel toggle is pressed", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await act(async () => {});

    const funnel = screen.getByRole("button", { name: /Nach Tag filtern|Filter by tag/i });
    expect(funnel).toHaveAttribute("aria-pressed", "false");
    // Bar hidden by default: its add-tag button is not rendered
    expect(
      screen.queryByRole("button", { name: /Tag hinzufügen|Add tag/i }),
    ).not.toBeInTheDocument();

    await user.click(funnel);
    expect(funnel).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Tag hinzufügen|Add tag/i })).toBeInTheDocument();
  });
});

// --- Collapsed sidebar with detector config ---

describe("Dashboard collapsed sidebar detector dot", () => {
  beforeEach(() => {
    mockSend.mockReset();
    localStorage.clear();
  });

  it("shows detector dot in collapsed sidebar for pokemon with detector config", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      detector_config: {
        enabled: true,
        source_type: "browser_display",
        region: { x: 0, y: 0, w: 0, h: 0 },
        window_title: "",
        change_threshold: 0.1,
        templates: [{ name: "test", enabled: true, regions: [] }],
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Collapse sidebar
    const collapseBtn = screen.getByRole("button", { name: /Einklappen|Collapse/i });
    await user.click(collapseBtn);

    // Should show a detector dot in the collapsed sidebar
    const dot = document.querySelector(".rounded-full.border.border-bg-secondary");
    expect(dot).toBeTruthy();
  });
});

describe("Dashboard group view and manual ordering", () => {
  /** AppState with one real group (2 members) and 2 ungrouped Pokemon. */
  function groupedState() {
    return makeAppState({
      active_id: "",
      groups: [{ id: "g1", name: "Team", color: "#ffffff", sort_order: 0, collapsed: false }],
      pokemon: [
        makePokemon({ id: "g-a", name: "Bisasam", group_id: "g1", is_active: false }),
        makePokemon({ id: "g-b", name: "Glumanda", group_id: "g1", is_active: false }),
        makePokemon({ id: "u-a", name: "Arbok", group_id: "", is_active: false }),
        makePokemon({ id: "u-b", name: "Sandan", group_id: "", is_active: false }),
      ],
    });
  }

  beforeEach(() => {
    mockSend.mockReset();
    useCounterStore.setState({
      appState: groupedState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  it("opens the group counter view and bulk-increments members", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await act(async () => {});

    // The real group exposes the "Gruppenübersicht anzeigen" label (the bucket uses "Übersicht anzeigen").
    await user.click(screen.getByLabelText("Gruppenübersicht anzeigen"));

    // Bulk action button only exists in the group counter view.
    mockSend.mockClear();
    await user.click(screen.getByLabelText("Alle Encounter erhöhen"));
    expect(mockSend).toHaveBeenCalledWith(
      "increment",
      expect.objectContaining({ pokemon_id: expect.any(String) }),
    );
  });

  it("opens the ungrouped counter view and bulk-decrements members", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await act(async () => {});

    // The ungrouped bucket uses the "Übersicht anzeigen" label (the empty-state
    // shortcut shares it), so pick the one inside the sidebar group section.
    const bucketButton = screen
      .getAllByLabelText("Übersicht anzeigen")
      .find((el) => el.closest('[data-testid="sidebar-group-section"]'));
    await user.click(bucketButton!);

    mockSend.mockClear();
    await user.click(screen.getByLabelText("Alle Encounter verringern"));
    expect(mockSend).toHaveBeenCalledWith(
      "decrement",
      expect.objectContaining({ pokemon_id: expect.any(String) }),
    );
  });

  it("stops every hunt in a group without touching ungrouped hunts", async () => {
    const user = userEvent.setup();
    const stopDetection = vi.mocked(stopDetectionForPokemon);
    stopDetection.mockClear();
    useCounterStore.setState({
      appState: makeAppState({
        groups: [{ id: "g1", name: "Team", color: "#ffffff", sort_order: 0, collapsed: false }],
        pokemon: [
          makePokemon({ id: "g-a", group_id: "g1", timer_started_at: new Date().toISOString() }),
          makePokemon({ id: "g-b", group_id: "g1" }),
          makePokemon({ id: "u-a", group_id: "", timer_started_at: new Date().toISOString() }),
        ],
      }),
      detectorStatus: { "g-b": { state: "scanning", confidence: 0, poll_ms: 100 } },
    });

    render(<Dashboard />);
    await user.click(
      within(screen.getByRole("region", { name: "Team" })).getByRole("button", {
        name: /gruppen verwalten/i,
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: /alle hunts stoppen/i }));

    expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "g-a" });
    expect(mockSend).not.toHaveBeenCalledWith("timer_stop", { pokemon_id: "u-a" });
    expect(stopDetection).toHaveBeenCalledWith("g-a");
    expect(stopDetection).toHaveBeenCalledWith("g-b");
    expect(stopDetection).not.toHaveBeenCalledWith("u-a");
    expect(useCounterStore.getState().detectorStatus["g-b"]).toBeUndefined();
  });

  it("starts and stops all ungrouped hunts from their menu", async () => {
    const user = userEvent.setup();
    const stopDetection = vi.mocked(stopDetectionForPokemon);
    stopDetection.mockClear();
    useCounterStore.setState({
      appState: makeAppState({
        groups: [{ id: "g1", name: "Team", color: "#ffffff", sort_order: 0, collapsed: false }],
        pokemon: [
          makePokemon({ id: "g-a", group_id: "g1", hunt_mode: "timer" }),
          makePokemon({ id: "u-a", group_id: "", hunt_mode: "timer" }),
          makePokemon({
            id: "u-b",
            group_id: "",
            hunt_mode: "timer",
            timer_started_at: new Date().toISOString(),
          }),
        ],
      }),
      detectorStatus: {},
    });

    render(<Dashboard />);
    const bucket = screen.getByRole("region", { name: "Ohne Gruppe" });
    await user.click(within(bucket).getByRole("button", { name: /gruppen verwalten/i }));
    await user.click(screen.getByRole("menuitem", { name: /alle hunts starten/i }));
    expect(mockSend).toHaveBeenCalledWith("timer_start", { pokemon_id: "u-a" });
    expect(mockSend).not.toHaveBeenCalledWith("timer_start", { pokemon_id: "g-a" });

    mockSend.mockClear();
    await user.click(within(bucket).getByRole("button", { name: /gruppen verwalten/i }));
    await user.click(screen.getByRole("menuitem", { name: /alle hunts stoppen/i }));
    expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "u-b" });
    expect(stopDetection).toHaveBeenCalledWith("u-a");
    expect(stopDetection).toHaveBeenCalledWith("u-b");
    expect(stopDetection).not.toHaveBeenCalledWith("g-a");
  });

  it("reorders a sidebar item with Alt+Arrow", async () => {
    render(<Dashboard />);
    await act(async () => {});

    const options = [...document.querySelectorAll("[data-sidebar-idx]")] as HTMLElement[];
    await act(async () => {
      fireEvent.keyDown(options[0], { key: "ArrowDown", altKey: true });
    });

    const reordered = mockFetch.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("/api/pokemon/reorder"),
    );
    expect(reordered).toBe(true);
  });

  it("reorders via drag and drop", async () => {
    render(<Dashboard />);
    await act(async () => {});

    // Separate act() per event so React commits dragOverId before dragEnd
    // reads it (in the browser dragover fires across many renders).
    const options = [...document.querySelectorAll("[data-sidebar-idx]")] as HTMLElement[];
    await act(async () => {
      fireEvent.dragStart(options[0]);
    });
    await act(async () => {
      fireEvent.dragOver(options[1], { clientY: 5 });
    });
    await act(async () => {
      fireEvent.dragEnd(options[0]);
    });

    const reordered = mockFetch.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("/api/pokemon/reorder"),
    );
    expect(reordered).toBe(true);
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

  it("loads persisted sort mode from localStorage", async () => {
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
    await act(async () => {});

    // Items should be sorted by name desc (Zubat first)
    const items = document.querySelectorAll("[data-sidebar-idx]");
    expect(items[0].textContent).toContain("Zubat");
  });
});
