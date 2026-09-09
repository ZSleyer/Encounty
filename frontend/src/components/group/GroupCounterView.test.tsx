import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, makePokemon, userEvent, act } from "../../test-utils";
import { GroupCounterView } from "./GroupCounterView";
import type { Group } from "../../types";

const group: Group = {
  id: "g1",
  name: "Team Rocket",
  color: "#ff0000",
  sort_order: 0,
  collapsed: false,
};

const members = [
  makePokemon({ id: "a", name: "Bisasam", encounters: 10, is_active: false }),
  makePokemon({ id: "b", name: "Glumanda", encounters: 5, is_active: false }),
];

function makeProps(overrides?: Partial<Parameters<typeof GroupCounterView>[0]>) {
  const props = {
    group,
    members,
    allPokemon: members,
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
    onReset: vi.fn(),
    onEdit: vi.fn(),
    onOpenDetector: vi.fn(),
    onBulkIncrement: vi.fn(),
    onBulkDecrement: vi.fn(),
    onBulkReset: vi.fn(),
    captureConnected: 0,
    captureEligible: 2,
    hasRememberedSource: false,
    captureDisabled: false,
    onRestoreSource: vi.fn(),
    onPickSource: vi.fn(),
    onDisconnectSource: vi.fn(),
    startDisabled: false,
    stopDisabled: false,
    onStartAll: vi.fn(),
    onStopAll: vi.fn(),
    ...overrides,
  };
  // A caller overriding `members` without its own snapshot gets a matching one,
  // so the phase lookup never sees entries the view does not render.
  return overrides?.members && !overrides.allPokemon
    ? { ...props, allPokemon: overrides.members }
    : props;
}

describe("GroupCounterView", () => {
  afterEach(() => vi.useRealTimers());

  it("renders the group name, member count and summed encounters", () => {
    render(<GroupCounterView {...makeProps()} />);
    expect(screen.getByRole("heading", { name: "Team Rocket" })).toBeInTheDocument();
    expect(screen.getByText("2 Pokémon")).toBeInTheDocument();
    // Sum of 10 + 5 rendered in the total chip.
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("renders the summed hunt time of all members", () => {
    const timed = [
      makePokemon({ id: "a", encounters: 10, timer_accumulated_ms: 3_600_000 }),
      makePokemon({ id: "b", encounters: 5, timer_accumulated_ms: 61_000 }),
    ];
    render(<GroupCounterView {...makeProps({ members: timed })} />);
    expect(screen.getByText("01:01:01")).toBeInTheDocument();
  });

  it("counts the phases of a member into both totals", () => {
    const parent = makePokemon({ id: "a", encounters: 10, timer_accumulated_ms: 1000 });
    const phase = makePokemon({
      id: "p1",
      encounters: 100,
      timer_accumulated_ms: 3_600_000,
      phase_of: "a",
      phase_number: 1,
      completed_at: "2024-01-02T00:00:00Z",
    });
    render(
      <GroupCounterView {...makeProps({ members: [parent], allPokemon: [parent, phase] })} />,
    );
    expect(screen.getByText("110")).toBeInTheDocument();
    expect(screen.getByText("01:00:01")).toBeInTheDocument();
  });

  it("ticks the time chip while a member timer runs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const running = [
      makePokemon({
        id: "a",
        encounters: 1,
        timer_accumulated_ms: 0,
        timer_started_at: "2024-01-01T00:00:00Z",
      }),
    ];
    render(<GroupCounterView {...makeProps({ members: running })} />);
    expect(screen.getByText("00:00:00")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("00:00:02")).toBeInTheDocument();
  });

  it("renders a card for every member", () => {
    render(<GroupCounterView {...makeProps()} />);
    expect(screen.getByText("Bisasam")).toBeInTheDocument();
    expect(screen.getByText("Glumanda")).toBeInTheDocument();
  });

  it("shows the empty state when there are no members", () => {
    render(<GroupCounterView {...makeProps({ members: [] })} />);
    expect(screen.getByText("Diese Gruppe hat noch keine Pokémon.")).toBeInTheDocument();
  });

  it("fires the bulk callbacks", async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<GroupCounterView {...props} />);

    await user.click(screen.getByLabelText("Alle Encounter erhöhen"));
    await user.click(screen.getByLabelText("Alle Encounter verringern"));
    await user.click(screen.getByLabelText("Alle Encounter zurücksetzen"));

    expect(props.onBulkIncrement).toHaveBeenCalledOnce();
    expect(props.onBulkDecrement).toHaveBeenCalledOnce();
    expect(props.onBulkReset).toHaveBeenCalledOnce();
  });

  it("offers one group source menu for display and camera", async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<GroupCounterView {...props} />);

    await user.click(screen.getByLabelText("Gruppenquelle verwalten"));
    await user.click(screen.getByText("Bildschirm oder Fenster wählen"));
    expect(props.onPickSource).toHaveBeenCalledWith("browser_display");
  });

  it("starts and stops every hunt from the header", async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<GroupCounterView {...props} />);

    await user.click(screen.getByLabelText("Alle Hunts starten"));
    await user.click(screen.getByLabelText("Alle Hunts stoppen"));
    expect(props.onStartAll).toHaveBeenCalledOnce();
    expect(props.onStopAll).toHaveBeenCalledOnce();
  });

  it("disconnects every connected group source", async () => {
    const props = makeProps({ captureConnected: 2 });
    const user = userEvent.setup();
    render(<GroupCounterView {...props} />);

    await user.click(screen.getByLabelText("Gruppenquelle verwalten"));
    await user.click(screen.getByText("Alle Quellen trennen"));
    expect(props.onDisconnectSource).toHaveBeenCalledOnce();
  });
});
