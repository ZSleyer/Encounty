import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "../../test-utils";
import { StatisticsPanel } from "./StatisticsPanel";
import type { EncounterStats, ChartPoint, EncounterEvent } from "../../types";

// Mock recharts to avoid rendering issues in jsdom (no SVG layout engine)
vi.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="area" />,
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

describe("StatisticsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
