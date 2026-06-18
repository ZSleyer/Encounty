import { describe, it, expect, vi } from "vitest";
import { render, screen, makePokemon, userEvent } from "../../test-utils";
import { GroupCounterView } from "./GroupCounterView";
import type { Group } from "../../types";

const group: Group = {
  id: "g1",
  name: "Team Rocket",
  color: "#ff0000",
  sort_order: 0,
  collapsed: false,
};

function makeProps(overrides?: Partial<Parameters<typeof GroupCounterView>[0]>) {
  return {
    group,
    members: [
      makePokemon({ id: "a", name: "Bisasam", encounters: 10, is_active: false }),
      makePokemon({ id: "b", name: "Glumanda", encounters: 5, is_active: false }),
    ],
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
    onReset: vi.fn(),
    onEdit: vi.fn(),
    onOpenDetector: vi.fn(),
    onBulkIncrement: vi.fn(),
    onBulkDecrement: vi.fn(),
    onBulkReset: vi.fn(),
    ...overrides,
  };
}

describe("GroupCounterView", () => {
  it("renders the group name, member count and summed encounters", () => {
    render(<GroupCounterView {...makeProps()} />);
    expect(screen.getByRole("heading", { name: "Team Rocket" })).toBeInTheDocument();
    expect(screen.getByText("2 Pokémon")).toBeInTheDocument();
    // Sum of 10 + 5 rendered in the total chip.
    expect(screen.getByText("15")).toBeInTheDocument();
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
});
