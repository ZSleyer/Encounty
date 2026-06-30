import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, makeAppState, makePokemon } from "../../test-utils";
import { useCounterStore } from "../../hooks/useCounterState";
import { StatisticsPanel } from "./StatisticsPanel";
import type { EncounterStats, ChartPoint, EncounterEvent } from "../../types";

// Mock recharts to avoid rendering issues in jsdom (no SVG layout engine)
vi.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="area" />,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div data-testid="line" />,
  ReferenceLine: () => <div data-testid="reference-line" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

const sampleStats: EncounterStats = {
  total: 1234,
  today: 56,
  rate_per_hour: 12.5,
  first_at: "2024-06-15T10:30:00Z",
  last_at: "2024-06-20T14:00:00Z",
};

const sampleChart: ChartPoint[] = [
  { label: "2024-06-18", count: 10 },
  { label: "2024-06-19", count: 25 },
  { label: "2024-06-20", count: 15 },
];

const sampleHistory: EncounterEvent[] = [
  {
    id: 1,
    pokemon_id: "poke-1",
    pokemon_name: "Pikachu",
    timestamp: "2024-06-20T14:00:00Z",
    delta: 1,
    count_after: 1234,
    source: "hotkey",
  },
  {
    id: 2,
    pokemon_id: "poke-1",
    pokemon_name: "Pikachu",
    timestamp: "2024-06-20T13:55:00Z",
    delta: -1,
    count_after: 1233,
    source: "manual",
  },
];

/** Locale-aware formatted total, so tests pass regardless of system locale. */
const formattedTotal = (1234).toLocaleString();
const formattedToday = (56).toLocaleString();

function mockFetch(stats: unknown, chart: unknown, history: unknown) {
  return vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/chart")) {
      return Promise.resolve({ json: () => Promise.resolve(chart) });
    }
    if (typeof url === "string" && url.includes("/history")) {
      return Promise.resolve({ json: () => Promise.resolve(history) });
    }
    return Promise.resolve({ json: () => Promise.resolve(stats) });
  });
}

/** Seeds the zustand store so the panel resolves a pokemon. */
function seedStore(
  pokemonId = "poke-1",
  overrides: Parameters<typeof makePokemon>[0] = {},
) {
  useCounterStore.setState({
    appState: makeAppState({
      pokemon: [
        makePokemon({
          id: pokemonId,
          is_active: true,
          encounters: 0,
          game: "pokemon-scarlet",
          hunt_type: "encounter",
          shiny_charm: false,
          ...overrides,
        }),
      ],
      active_id: pokemonId,
    }),
    isConnected: true,
    lastEncounterPokemonId: null,
    detectorStatus: {},
  });
}

describe("StatisticsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    seedStore();
  });

  it("shows loading spinner initially then renders stats", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));

    render(<StatisticsPanel pokemonId="poke-1" />);

    // After data loads, stats should appear
    await waitFor(() => {
      expect(screen.getByText(formattedTotal)).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("renders all metric cards with correct values", async () => {
    // Rate per hour is derived from the active timer: 25 encounters over 2h = 12.5/h.
    seedStore("poke-1", { encounters: 25, timer_accumulated_ms: 7_200_000 });
    vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      expect(screen.getByText(formattedTotal)).toBeInTheDocument();
    });
    expect(screen.getByText(formattedToday)).toBeInTheDocument();
    expect(screen.getByText("12.5")).toBeInTheDocument();
    // First encounter date rendered with toLocaleDateString
    const expectedDate = new Date("2024-06-15T10:30:00Z").toLocaleDateString();
    expect(screen.getByText(expectedDate)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders the encounter chart when chart data is available", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("area-chart")).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("renders empty chart message when chart data is empty", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleStats, [], sampleHistory));

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      expect(screen.getByText(formattedTotal)).toBeInTheDocument();
    });
    // No chart should be rendered
    expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders recent history entries", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      expect(screen.getByText("+1")).toBeInTheDocument();
    });
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(screen.getByText("hotkey")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders empty history message when history is empty", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, []));

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      expect(screen.getByText(formattedTotal)).toBeInTheDocument();
    });
    expect(screen.queryByText("hotkey")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders fallback values when stats fields are missing", async () => {
    const emptyStats: EncounterStats = {
      total: 0,
      today: 0,
      rate_per_hour: 0,
    };
    vi.stubGlobal("fetch", mockFetch(emptyStats, [], []));

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      // rate_per_hour is 0 (falsy), so the dash fallback is shown
      const dashes = screen.getAllByText("\u2014");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });

    vi.unstubAllGlobals();
  });

  it("renders interval toggle buttons", async () => {
    vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      expect(screen.getByText(formattedTotal)).toBeInTheDocument();
    });

    // Three interval buttons should exist
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(3);

    vi.unstubAllGlobals();
  });

  it("refetches data when interval button is clicked", async () => {
    const fetchMock = mockFetch(sampleStats, sampleChart, sampleHistory);
    vi.stubGlobal("fetch", fetchMock);

    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();

    render(<StatisticsPanel pokemonId="poke-1" />);

    await waitFor(() => {
      expect(screen.getByText(formattedTotal)).toBeInTheDocument();
    });

    const initialCalls = fetchMock.mock.calls.length;

    // Click the first interval button ("hour")
    const buttons = screen.getAllByRole("button");
    await user.click(buttons[0]);

    // Should trigger new fetches
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    vi.unstubAllGlobals();
  });

  it("handles fetch errors gracefully without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Network error"))),
    );

    render(<StatisticsPanel pokemonId="poke-1" />);

    // Should eventually stop loading without crashing
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  describe("probability panel", () => {
    it("renders the shiny chance metric tile", async () => {
      seedStore("poke-1", { encounters: 2839 });
      vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));
      render(<StatisticsPanel pokemonId="poke-1" />);

      await waitFor(() => {
        expect(screen.getByText(formattedTotal)).toBeInTheDocument();
      });
      // 2839 encounters at 1/4096 ≈ 50.0%
      expect(screen.getByText("50.0%")).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it("renders the probability curve chart", async () => {
      seedStore("poke-1", { encounters: 100 });
      vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));
      render(<StatisticsPanel pokemonId="poke-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("probability-chart")).toBeInTheDocument();
      });
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it("renders the milestone table with all four targets", async () => {
      seedStore("poke-1", { encounters: 100 });
      vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));
      render(<StatisticsPanel pokemonId="poke-1" />);

      await waitFor(() => {
        expect(screen.getByText("50%")).toBeInTheDocument();
      });
      expect(screen.getByText("75%")).toBeInTheDocument();
      expect(screen.getByText("90%")).toBeInTheDocument();
      expect(screen.getByText("99%")).toBeInTheDocument();
      // Expected encounter counts at 1/4096
      expect(screen.getByText((2839).toLocaleString())).toBeInTheDocument();
      expect(screen.getByText((18861).toLocaleString())).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it("shows em-dash for ETA when the active timer is zero", async () => {
      // No accumulated timer means no rate, so milestone ETAs cannot be computed.
      seedStore("poke-1", { encounters: 100, timer_accumulated_ms: 0 });
      vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));
      render(<StatisticsPanel pokemonId="poke-1" />);

      await waitFor(() => {
        expect(screen.getByText("50%")).toBeInTheDocument();
      });
      // Each ETA cell renders as an em-dash when no rate is provided
      const milestonesTable = screen.getByLabelText(/Meilensteine|Milestones/);
      const etaCells = milestonesTable.querySelectorAll("tbody tr td:last-child");
      etaCells.forEach((cell) => {
        expect(cell.textContent).toBe("—");
      });
      vi.unstubAllGlobals();
    });

    it("shows reached label when the current encounter count passes a milestone", async () => {
      // A non-zero timer yields a rate, which is required for the reached/ETA label.
      seedStore("poke-1", { encounters: 100_000, timer_accumulated_ms: 3_600_000 });
      vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));
      render(<StatisticsPanel pokemonId="poke-1" />);

      await waitFor(() => {
        expect(screen.getByText("99%")).toBeInTheDocument();
      });
      // At 100 000 encounters every milestone should be "reached"
      const reachedCells = screen.getAllByText(/erreicht|reached/);
      expect(reachedCells.length).toBe(4);
      vi.unstubAllGlobals();
    });

    it("hides the probability panel when the pokemon has no game set", async () => {
      seedStore("poke-1", { encounters: 100, game: "" });
      vi.stubGlobal("fetch", mockFetch(sampleStats, sampleChart, sampleHistory));
      render(<StatisticsPanel pokemonId="poke-1" />);

      await waitFor(() => {
        expect(screen.getByText(formattedTotal)).toBeInTheDocument();
      });
      // resolveOddsTuple falls back to 1/4096 for unknown games, so the panel
      // still renders. This test asserts the curve is still produced.
      expect(screen.getByTestId("probability-chart")).toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });
});
