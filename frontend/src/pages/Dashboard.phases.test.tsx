/**
 * Dashboard.phases.test.tsx: ending a phase, phase totals, history and archive view.
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

// --- Phasing: end-phase button visibility ---

describe("Dashboard phase end button", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("shows the end-phase action for a running phaseable hunt", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "hunt-1" })],
        active_id: "hunt-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByLabelText("Phase beenden")).toBeInTheDocument();
  });

  it("hides the end-phase action once the hunt is completed", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "hunt-1", completed_at: "2025-01-01T00:00:00Z" })],
        active_id: "hunt-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.queryByLabelText("Phase beenden")).not.toBeInTheDocument();
  });

  it("shows the end-phase action for a soft-reset hunt", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "hunt-1", hunt_type: "soft_reset" })],
        active_id: "hunt-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByLabelText("Phase beenden")).toBeInTheDocument();
  });

  it("hides the end-phase action on a phase entry itself", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "hunt-1", is_active: false }),
          makePokemon({ id: "phase-1", name: "Glumanda", phase_of: "hunt-1", phase_number: 1 }),
        ],
        active_id: "phase-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.queryByLabelText("Phase beenden")).not.toBeInTheDocument();
  });
});

// --- Phasing: badge, total chips and history ---

describe("Dashboard phase totals and history", () => {
  /** Parent hunt plus one finished phase below it. */
  function phasedState() {
    return makeAppState({
      pokemon: [
        makePokemon({
          id: "hunt-1",
          name: "Bisasam",
          encounters: 100,
          timer_accumulated_ms: 60000,
        }),
        makePokemon({
          id: "phase-1",
          name: "Glumanda",
          canonical_name: "charmander",
          encounters: 7,
          timer_accumulated_ms: 5000,
          completed_at: "2025-01-01T00:00:00Z",
          phase_of: "hunt-1",
          phase_number: 1,
          is_active: false,
        }),
      ],
      active_id: "hunt-1",
    });
  }

  beforeEach(() => {
    mockSend.mockReset();
  });

  it("hides badge, total chips and history while the hunt has no phases", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "hunt-1", encounters: 100 })],
        active_id: "hunt-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.queryByText("Phase 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Total-Encounter")).not.toBeInTheDocument();
    expect(screen.queryByText("Gesamtzeit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Phasen-Historie")).not.toBeInTheDocument();
  });

  it("shows badge, total chips and history once a phase exists", async () => {
    useCounterStore.setState({
      appState: phasedState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    // Running phase is max(finished) + 1.
    expect(screen.getByText("Phase 2")).toBeInTheDocument();

    // Totals: 100 own encounters + 7 from the phase, 60s + 5s of timer. The
    // numbers sit in a nested span, so read them off the chip they belong to.
    expect(screen.getByText("Total-Encounter").textContent).toBe("Total-Encounter107");
    expect(screen.getByText("Gesamtzeit").textContent).toBe("Gesamtzeit00:01:05");

    const history = screen.getByLabelText("Phasen-Historie");
    const entry = screen.getByLabelText("Phase 1: Glumanda öffnen");
    expect(history).toContainElement(entry);
    expect(entry.textContent).toContain("P1");
    expect(entry.textContent).toContain("Glumanda");
    expect(entry.textContent).toContain("00:00:05");
  });

  it("switches the sidebar to the pokedex tab when a caught entry is opened", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: phasedState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: /^Aktiv\b/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The phase entry is completed, so opening it must land on a visible row.
    await user.click(screen.getByLabelText("Phase 1: Glumanda öffnen"));

    expect(screen.getByRole("button", { name: /^Pokédex\b/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const sidebarItems = [...document.querySelectorAll("[data-sidebar-idx]")];
    expect(sidebarItems.some((el) => el.textContent?.includes("Glumanda"))).toBe(true);
  });

  it("marks the parent hunt row in the sidebar with the running phase number", async () => {
    useCounterStore.setState({
      appState: phasedState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const rows = [...document.querySelectorAll("[data-sidebar-idx]")] as HTMLElement[];
    const parentRow = rows.find((row) => row.textContent?.includes("Bisasam"));
    expect(parentRow).toBeTruthy();
    expect(parentRow!.textContent).toContain("P2");
  });
});

// --- Phasing: origin line, reactivate visibility and undo ---

describe("Dashboard phase entry archive view", () => {
  /** Completed phase entry, optionally orphaned by pointing at a missing parent. */
  function phaseChild(parentId: string) {
    return makePokemon({
      id: "phase-1",
      name: "Glumanda",
      canonical_name: "charmander",
      encounters: 7,
      completed_at: "2025-01-01T00:00:00Z",
      phase_of: parentId,
      phase_number: 1,
    });
  }

  beforeEach(() => {
    mockSend.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("shows the origin line and a link back to the parent hunt", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "hunt-1", name: "Bisasam", is_active: false }),
          phaseChild("hunt-1"),
        ],
        active_id: "phase-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const parentLink = screen.getByLabelText("Zur Hunt Bisasam springen");
    expect(parentLink.textContent).toBe("Phase 1 von Bisasam");
  });

  it("falls back to the orphaned label and drops the parent link when the parent is gone", async () => {
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [phaseChild("gone-1")],
        active_id: "phase-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    expect(screen.getByText("Phase 1 · Eltern-Hunt gelöscht")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Zur Hunt .* springen/)).not.toBeInTheDocument();
  });

  it("hides the reactivate action for a phase entry", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "hunt-1", name: "Bisasam", is_active: false }),
          phaseChild("hunt-1"),
        ],
        active_id: "phase-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const header = document.querySelector("header");
    const kebab = header?.querySelector("button[aria-label*='Weitere Aktionen']") as HTMLElement;
    expect(kebab).toBeTruthy();
    await user.click(kebab);

    // Edit is there, so the menu really is open; reactivate is not offered.
    expect(screen.getByLabelText(/^Bearbeiten$/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Reaktivieren")).not.toBeInTheDocument();
  });

  it("still offers the reactivate action for a plain completed hunt", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [makePokemon({ id: "hunt-1", completed_at: "2025-01-01T00:00:00Z" })],
        active_id: "hunt-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    const header = document.querySelector("header");
    const kebab = header?.querySelector("button[aria-label*='Weitere Aktionen']") as HTMLElement;
    await user.click(kebab);

    expect(screen.getByLabelText("Reaktivieren")).toBeInTheDocument();
  });

  it("deletes the newest phase after confirming the undo action", async () => {
    const user = userEvent.setup();
    useCounterStore.setState({
      appState: makeAppState({
        pokemon: [
          makePokemon({ id: "hunt-1", name: "Bisasam", is_active: false }),
          phaseChild("hunt-1"),
        ],
        active_id: "phase-1",
      }),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });

    render(<Dashboard />);
    await act(async () => {});

    await user.click(screen.getByLabelText("Phase rückgängig machen"));

    // Undoing drops the archive entry, so it goes through the destructive confirm.
    const confirmBtns = screen.getAllByText(/Bestätigen|Confirm/i);
    const dialogConfirm = confirmBtns.find((el) => el.closest("dialog") !== null);
    expect(dialogConfirm).toBeTruthy();
    await user.click(dialogConfirm!);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pokemon/phase-1/phase"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
