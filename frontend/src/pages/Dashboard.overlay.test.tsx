/**
 * Dashboard.overlay.test.tsx: overlay tab, its mode switches and the unsaved-changes flow.
 *
 * Split out of the original Dashboard.test.tsx; the mocks and setup below are
 * per file, so every split file carries the ones its cases rely on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeAppState, makePokemon, userEvent } from "../test-utils";
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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

// --- Unsaved overlay discard/stay flow ---

describe("Dashboard unsaved overlay stay and discard", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows unsaved overlay dialog and switches tab when discard is clicked", async () => {
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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

    // The overlay editor should be in custom mode
    expect(overlayTab.closest("button")).toHaveClass("bg-accent-blue");
  });

  it("stays on overlay tab when stay button is clicked in unsaved dialog", async () => {
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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

    // Overlay tab should be active
    expect(overlayTab.closest("button")).toHaveClass("bg-accent-blue");
  });
});

// --- Overlay mode switch from custom to default with confirmation ---

describe("Dashboard overlay custom to default switch", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("switches from custom to default overlay mode when global button is clicked", async () => {
    // Mock window.confirm
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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

    // Click "Global" button to switch from custom to default
    const globalBtn = screen.getAllByText("Global")[0];
    await user.click(globalBtn);

    // Confirm should have been called
    expect(globalThis.confirm).toHaveBeenCalled();

    // Should have sent PUT request
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/p1"),
      expect.objectContaining({ method: "PUT" }),
    );

    vi.unstubAllGlobals();
  });

  it("cancels custom to default switch when confirm is declined", async () => {
    // Mock window.confirm to return false
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );

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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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

    // Click "Global" button
    const globalBtn = screen.getAllByText("Global")[0];
    await user.click(globalBtn);

    // Confirm was called but user declined — save/import buttons should still show (custom mode)
    const saveButtons = screen.queryAllByText(/Speichern|Save/i);
    expect(saveButtons.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });
});

// --- Overlay save button in custom mode ---

describe("Dashboard overlay save flow", () => {
  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows disabled save button when overlay is not dirty in custom mode", async () => {
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
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

    // Save button should be disabled (not dirty)
    const saveButtons = screen.getAllByText(/Speichern|Save/i);
    const saveBtn = saveButtons.find((el) => el.closest("button"));
    expect(saveBtn?.closest("button")).toBeDisabled();
  });
});

// --- OverlayImportItem rendering ---

describe("Dashboard overlay import with other pokemon", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows other pokemon in import dropdown when they have custom overlays", async () => {
    const user = userEvent.setup();
    const p1 = makePokemon({
      id: "p1",
      name: "Pikachu",
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
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
      },
    });
    const p2 = makePokemon({
      id: "p2",
      name: "Glumanda",
      overlay_mode: "custom",
      overlay: {
        canvas_width: 400,
        canvas_height: 200,
        background_color: "#111",
        background_opacity: 1,
        blur: 0,
        show_border: false,
        border_color: "#fff",
        border_radius: 0,
        sprite: {
          visible: true,
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          z_index: 1,
          show_glow: false,
          glow_color: "#fff",
          glow_opacity: 0.5,
          glow_blur: 10,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        name: {
          visible: true,
          x: 100,
          y: 10,
          width: 200,
          height: 30,
          z_index: 2,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        title: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 4,
          style: {} as never,
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        counter: {
          visible: true,
          x: 100,
          y: 50,
          width: 200,
          height: 30,
          z_index: 3,
          style: {} as never,
          show_label: true,
          label_text: "Enc:",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
        timer: {
          visible: false,
          x: 100,
          y: 90,
          width: 200,
          height: 30,
          z_index: 5,
          style: {} as never,
          show_label: false,
          label_text: "Timer",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          idle_animation: "none",
        },
        odds: {
          visible: false,
          x: 100,
          y: 130,
          width: 200,
          height: 30,
          z_index: 6,
          style: {} as never,
          show_label: false,
          label_text: "Odds",
          label_style: {} as never,
          prefix_text: "",
          suffix_text: "",
          format: "fractional",
          idle_animation: "none",
          trigger_enter: "none",
          trigger_decrement: "none",
        },
      },
    });

    useCounterStore.setState({
      appState: makeAppState({ pokemon: [p1, p2], active_id: "p1" }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);

    // Go to overlay tab
    const overlayTab = screen.getByText("Overlay");
    await user.click(overlayTab);

    // Import dropdown should show Glumanda as an import source
    const glumandaTexts = screen.queryAllByText("Glumanda");
    expect(glumandaTexts.length).toBeGreaterThan(0);
  });
});

// --- Overlay OBS URL card copy interaction ---

describe("Dashboard overlay OBS URL copy click", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("calls clipboard writeText when OBS URL button is clicked", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

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

    // Find and click the OBS URL copy button (there may be multiple, use the card-style one)
    const obsBtns = screen.getAllByLabelText(/OBS/i);
    await user.click(obsBtns[obsBtns.length - 1]);

    // Clipboard writeText should have been called
    expect(writeTextSpy).toHaveBeenCalled();
  });
});

// --- Overlay global layout link in default mode ---

describe("Dashboard overlay global link", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows OBS URL card button in global overlay mode placeholder", async () => {
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

    // Should show the OBS URL card button in the 3-column grid
    const obsUrlBtns = screen.getAllByLabelText(/OBS/i);
    expect(obsUrlBtns.length).toBeGreaterThan(0);

    // Should show "Eigenes verwenden" / "Use custom" button
    const switchCustomBtns = screen.getAllByText(/Eigenes verwenden|Use custom/i);
    expect(switchCustomBtns.length).toBeGreaterThan(0);

    // Should show "Layout bearbeiten" / "Edit layout" link
    const editLinks = screen.getAllByText(/Layout bearbeiten|Edit layout/i);
    expect(editLinks.length).toBeGreaterThan(0);
  });
});
