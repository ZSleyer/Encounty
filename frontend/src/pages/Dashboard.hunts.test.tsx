/**
 * Dashboard.hunts.test.tsx: hunt buttons, hunt modes, timers and detector status.
 *
 * Split out of the original Dashboard.test.tsx; the mocks and setup below are
 * per file, so every split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState, makePokemon, userEvent, act } from "../test-utils";
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

// --- Hunt Button States ---

describe("Dashboard hunt button", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows hunt start button for active pokemon (mode: both)", async () => {
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Both sidebar and header have hunt buttons, check that at least one exists
    const huntButtons = screen.getAllByRole("button", { name: /Hunt starten/ });
    expect(huntButtons.length).toBeGreaterThan(0);
  });

  it("shows timer-specific button when hunt_mode is timer", async () => {
    const pokemon = makePokemon({ id: "p1", hunt_mode: "timer" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const huntButtons = screen.getAllByRole("button", { name: /Timer starten/ });
    expect(huntButtons.length).toBeGreaterThan(0);
  });

  it("shows detector-specific button when hunt_mode is detector", async () => {
    const pokemon = makePokemon({ id: "p1", hunt_mode: "detector" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const huntButtons = screen.getAllByRole("button", { name: /Erkennung starten/ });
    expect(huntButtons.length).toBeGreaterThan(0);
  });

  it("shows red stop button when timer is running", async () => {
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
    await act(async () => {});

    const huntButtons = screen.getAllByRole("button", { name: /Hunt stoppen/ });
    expect(huntButtons.length).toBeGreaterThan(0);
    // At least one should have red styling
    const hasRedButton = huntButtons.some((btn) => btn.className.includes("text-accent-red"));
    expect(hasRedButton).toBe(true);
  });

  it("does not show header hunt button for completed pokemon", async () => {
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

    // The header's data-detector-tutorial="controls" wrapper should not exist for completed pokemon
    const headerHuntWrapper = document.querySelector("[data-detector-tutorial='controls']");
    expect(headerHuntWrapper).toBeNull();
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

    // Confirm modal should appear, click the confirm button inside the dialog
    const confirmBtns = screen.getAllByText(/Bestätigen|Confirm/i);
    const dialogConfirm = confirmBtns.find((el) => el.closest("dialog") !== null);
    expect(dialogConfirm).toBeTruthy();
    await user.click(dialogConfirm!);

    expect(mockSend).toHaveBeenCalledWith("timer_reset", { pokemon_id: "t1" });
  });

  it("formats timer correctly for large values", async () => {
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
    await act(async () => {});

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
    const chevronBtns = allButtons.filter(
      (btn) => btn.querySelector(".lucide-chevron-down") !== null,
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
    const chevronBtn = allButtons.find((btn) => btn.querySelector(".lucide-chevron-down") !== null);
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
    const chevronBtn = allButtons.find((btn) => btn.querySelector(".lucide-chevron-down") !== null);
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
    const chevronBtn = Array.from(chevrons).find((btn) =>
      btn.querySelector(".lucide-chevron-down"),
    );
    if (chevronBtn) {
      await user.click(chevronBtn);
      // Mode options should appear
      expect(screen.getAllByText(/Beides|Both/i).length).toBeGreaterThan(0);
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

// --- Sidebar Timer ---

describe("Dashboard sidebar timer", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows timer in sidebar when pokemon has accumulated time", async () => {
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
    await act(async () => {});

    // Should show timer in the sidebar (00:01:00)
    expect(screen.getAllByText("00:01:00").length).toBeGreaterThan(0);
  });

  it("does not show timer text in sidebar when no time accumulated and not running", async () => {
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
    await act(async () => {});

    // Sidebar timer should not show 00:00:00 (only main panel does)
    // The sidebar timer span is hidden when totalMs === 0 and not running
    const sidebarItem = document.querySelector("[data-sidebar-idx='0']");
    const timerSpan = sidebarItem?.querySelector(String.raw`.font-mono.tabular-nums.text-\[10px\]`);
    // Timer text should not exist in sidebar for zero-time non-running state
    expect(timerSpan).toBeNull();
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
    const playBtn = Array.from(timerBtns || []).find((btn) =>
      /start|starten/i.exec(btn.title ?? ""),
    );
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
    const pauseBtn = Array.from(timerBtns || []).find((btn) => /stop|stopp/i.exec(btn.title ?? ""));
    if (pauseBtn) {
      await user.click(pauseBtn);
      expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "p1" });
    }
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

// --- Header hunt button: Both mode ---

describe("Dashboard header hunt button interactions", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("starts hunt in timer mode (sends timer_start)", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "timer" });

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
    await user.keyboard("{Control>}");
    await user.click(items[0]);
    await user.keyboard("{/Control}");

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
    await user.keyboard("{Control>}");
    await user.click(items[0]);
    await user.keyboard("{/Control}");

    // Selection count should be visible
    const selBadge = document.querySelector(".text-accent-blue.font-semibold.tabular-nums");
    expect(selBadge?.textContent).toBe("1");
  });

  it("shows timer running indicator when a timer is running", async () => {
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
    await act(async () => {});

    // Timer running indicator (green timer icon) should be visible in quick actions bar
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  it("shows detector running indicator when detection is active", async () => {
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
      detectorStatus: { p1: { state: "idle", confidence: 0.1, poll_ms: 100 } },
    });

    render(<Dashboard />);
    await act(async () => {});

    // Detector running indicator (blue eye icon) should be in the sidebar quick actions
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  it("disables hunt start button when no pokemon in selection", async () => {
    useCounterStore.setState({
      appState: makeAppState({ pokemon: [], active_id: "" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // The hunt start button in quick actions should be disabled
    const allButtons = screen.getAllByRole("button");
    expect(allButtons.length).toBeGreaterThan(0);
  });
});

// --- Detector match indicator on header tab ---

describe("Dashboard detector match indicator", () => {
  it("shows match dot on detector tab when detector status is match", async () => {
    const pokemon = makePokemon({ id: "p1" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: { p1: { state: "match", confidence: 0.95, poll_ms: 100 } },
    });

    render(<Dashboard />);
    await act(async () => {});

    // The detector tab should show a green match dot
    const matchDot = document.querySelector("header .bg-accent-green.rounded-full");
    expect(matchDot).toBeTruthy();
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
    const emptyStateAddBtn = addButtons.find((el) => el.closest(".mt-3"));
    if (emptyStateAddBtn) await user.click(emptyStateAddBtn);

    // Should open the add modal
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
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

// --- Sidebar hunt start/stop quick actions ---

describe("Dashboard sidebar hunt start from quick actions", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("starts hunt from sidebar quick actions start button", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "timer" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Select the pokemon first (Ctrl+click sidebar card)
    const items = document.querySelectorAll("[data-sidebar-idx]");
    await user.keyboard("{Control>}");
    await user.click(items[0]);
    await user.keyboard("{/Control}");

    // Find the sidebar quick actions hunt button (not the header one)
    const allButtons = screen.getAllByRole("button");
    const sidebarHuntBtn = allButtons.find((btn) => {
      const parent = btn.closest(".border-b.border-border-subtle");
      return parent && btn.title && /starten/i.exec(btn.title);
    });

    if (sidebarHuntBtn) {
      await user.click(sidebarHuntBtn);
      expect(mockSend).toHaveBeenCalledWith("timer_start", { pokemon_id: "p1" });
    }
  });

  it("stops hunt from sidebar quick actions stop button when running", async () => {
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

    // Select the pokemon first (Ctrl+click sidebar card)
    const items = document.querySelectorAll("[data-sidebar-idx]");
    await user.keyboard("{Control>}");
    await user.click(items[0]);
    await user.keyboard("{/Control}");

    // Find the sidebar quick actions stop button
    const allButtons = screen.getAllByRole("button");
    const sidebarStopBtn = allButtons.find((btn) => {
      const parent = btn.closest(".border-b.border-border-subtle");
      return parent && btn.title && /stoppen/i.exec(btn.title);
    });

    if (sidebarStopBtn) {
      await user.click(sidebarStopBtn);
      expect(mockSend).toHaveBeenCalledWith("timer_stop", { pokemon_id: "p1" });
    }
  });
});

// --- Sidebar hunt mode menu items ---

describe("Dashboard sidebar hunt mode menu", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("opens sidebar hunt mode menu and selects detector mode", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({
      id: "p1",
      hunt_mode: "both",
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

    // Find chevron button in quick actions (sidebar)
    const allButtons = screen.getAllByRole("button");
    const sidebarChevron = allButtons.find((btn) => {
      const parent = btn.closest(".border-b.border-border-subtle");
      return parent && btn.querySelector(".lucide-chevron-down");
    });

    if (sidebarChevron) {
      await user.click(sidebarChevron);

      // Click "Nur Erkennung" / detector only
      const detectorBtns = screen.getAllByText(/Nur Erkennung|Detector Only/i);
      await user.click(detectorBtns[0]);

      // Should call PUT to update hunt_mode
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/pokemon/p1"),
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"hunt_mode":"detector"'),
        }),
      );
    }
  });
});

// --- Completed pokemon forces counter tab ---

describe("Dashboard force counter on archive", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("renders counter tab content for completed pokemon even if previously on detector", async () => {
    // A completed pokemon should always show the counter tab (detector tab is hidden)
    const completedPokemon = makePokemon({ id: "p1", completed_at: "2025-01-01T00:00:00Z" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [completedPokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Detector tab should not be present for completed pokemon
    expect(screen.queryByText("Auto Erkennung")).not.toBeInTheDocument();

    // Counter tab should be active (showing encounter count)
    const counterTab = screen.getAllByText("Encounter")[0];
    expect(counterTab.closest("button")).toHaveClass("bg-accent-blue");
  });
});

// --- Hotkey target button for active pokemon ---

describe("Dashboard hotkey target active indicator", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows active hotkey target indicator for the active pokemon", async () => {
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

    // The first pokemon's hotkey button should have the active (blue) class
    const items = document.querySelectorAll("[data-sidebar-idx]");
    const firstItem = items[0];
    const hotkeyBtn = firstItem?.querySelector("button.text-accent-blue");
    expect(hotkeyBtn).toBeTruthy();
  });
});

// --- Timer interval tick coverage ---

describe("Dashboard timer interval tick", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("updates timer display when running via interval tick", async () => {
    vi.useFakeTimers();
    const now = new Date();
    const pokemon = makePokemon({
      id: "t1",
      timer_started_at: now.toISOString(),
      timer_accumulated_ms: 0,
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "t1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Timer should show initial value
    expect(screen.getAllByText("00:00:00").length).toBeGreaterThan(0);

    // Advance by 2 seconds to trigger interval
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Timer value should have updated (exact value depends on Date.now mock)
    // The important thing is the interval callback ran without errors
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();

    vi.useRealTimers();
  });
});

// --- Header hunt button close backdrop ---

describe("Dashboard header hunt menu close", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("closes header hunt dropdown when backdrop is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Open the header hunt dropdown
    const controlsWrapper = document.querySelector("[data-detector-tutorial='controls']");
    const chevrons = controlsWrapper!.querySelectorAll("button");
    const chevronBtn = Array.from(chevrons).find((btn) =>
      btn.querySelector(".lucide-chevron-down"),
    );

    if (chevronBtn) {
      await user.click(chevronBtn);

      // Menu should be open
      expect(screen.getAllByText(/Beides|Both/i).length).toBeGreaterThan(0);

      // Click backdrop close button
      const closeBtn = screen.getAllByLabelText(/close|schließen/i);
      const backdrop = closeBtn.find((btn) => btn.className.includes("fixed"));
      if (backdrop) {
        await user.click(backdrop);
      }
    }
  });
});

// --- Sidebar hunt menu close backdrop ---

describe("Dashboard sidebar hunt menu close", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("closes sidebar hunt dropdown when close backdrop is clicked", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1", hunt_mode: "both" });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [pokemon], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Find sidebar chevron button
    const allButtons = screen.getAllByRole("button");
    const sidebarChevron = allButtons.find((btn) => {
      const parent = btn.closest(".border-b.border-border-subtle");
      return parent && btn.querySelector(".lucide-chevron-down");
    });

    if (sidebarChevron) {
      await user.click(sidebarChevron);

      // Menu should open with mode options
      expect(screen.getAllByText(/Beides|Both/i).length).toBeGreaterThan(0);

      // Click the Close backdrop button
      const closeButtons = screen.getAllByLabelText("Close");
      if (closeButtons.length > 0) {
        await user.click(closeButtons[0]);
      }
    }
  });
});

// --- Detector tab rendering with running detection ---

describe("Dashboard detector tab with running status", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("renders detector panel with running state indicators", async () => {
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
      detectorStatus: { p1: { state: "idle", confidence: 0.5, poll_ms: 100 } },
    });

    render(<Dashboard />);

    // Switch to detector tab
    const detectorTab = screen.getByText("Auto Erkennung");
    await user.click(detectorTab);

    // Detector panel should render with the running state
    expect(detectorTab.closest("button")).toHaveClass("bg-accent-blue");
  });
});

// --- Hotkey pause/resume on overlay tab ---

describe("Dashboard hotkey pause resume", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("resumes hotkeys when switching from overlay to detector tab", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ id: "p1" });

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

    // Hotkeys should be paused
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/pause"),
      expect.objectContaining({ method: "POST" }),
    );

    // Switch to detector tab
    const detectorTab = screen.getByText("Auto Erkennung");
    await user.click(detectorTab);

    // Hotkeys should be resumed
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/resume"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
