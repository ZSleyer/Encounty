import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makePokemon } from "../../test-utils";
import { PokemonCard } from "./PokemonCard";
import { useCounterStore } from "../../hooks/useCounterState";

describe("PokemonCard", () => {
  const defaultProps = {
    pokemon: makePokemon(),
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
    onReset: vi.fn(),
    onActivate: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
  };

  it("renders pokemon name and encounters", () => {
    render(<PokemonCard {...defaultProps} />);
    expect(screen.getByText("Bisasam")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders encounter count", () => {
    const pokemon = makePokemon({ encounters: 100 });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("calls onIncrement when the + button is clicked", async () => {
    const onIncrement = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<PokemonCard {...defaultProps} onIncrement={onIncrement} />);
    await user.click(screen.getByTitle("Encounter hinzufügen (+1)"));
    expect(onIncrement).toHaveBeenCalledWith("poke-1");
  });

  it("calls onDecrement when the - button is clicked", async () => {
    const onDecrement = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<PokemonCard {...defaultProps} onDecrement={onDecrement} />);
    await user.click(screen.getByTitle("Encounter entfernen (-1)"));
    expect(onDecrement).toHaveBeenCalledWith("poke-1");
  });

  it("calls onReset when the reset button is clicked", async () => {
    const onReset = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<PokemonCard {...defaultProps} onReset={onReset} />);
    await user.click(screen.getByTitle("Zähler zurücksetzen"));
    expect(onReset).toHaveBeenCalledWith("poke-1");
  });

  it("calls onEdit when the edit button is clicked", async () => {
    const onEdit = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<PokemonCard {...defaultProps} onEdit={onEdit} />);
    await user.click(screen.getByTitle("Pokémon bearbeiten"));
    expect(onEdit).toHaveBeenCalledWith(defaultProps.pokemon);
  });

  it("calls onActivate when the activate button is clicked", async () => {
    const onActivate = vi.fn();
    const inactivePokemon = makePokemon({ is_active: false });
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <PokemonCard {...defaultProps} pokemon={inactivePokemon} onActivate={onActivate} />,
    );
    await user.click(screen.getByText("Aktivieren"));
    expect(onActivate).toHaveBeenCalledWith("poke-1");
  });

  it("does not call onActivate when an active card is clicked", async () => {
    const onActivate = vi.fn();
    const activePokemon = makePokemon({ is_active: true });
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <PokemonCard {...defaultProps} pokemon={activePokemon} onActivate={onActivate} />,
    );
    await user.click(screen.getByText("Bisasam"));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<PokemonCard {...defaultProps} onDelete={onDelete} />);
    await user.click(screen.getByText("Löschen"));
    expect(onDelete).toHaveBeenCalledWith("poke-1");
  });

  it("shows active star indicator when pokemon is active", () => {
    const activePokemon = makePokemon({ is_active: true });
    render(<PokemonCard {...defaultProps} pokemon={activePokemon} />);
    expect(screen.getByTitle("Dieses Pokémon wird von Hotkeys gesteuert")).toBeInTheDocument();
  });

  it("does not show active star for inactive pokemon", () => {
    const inactivePokemon = makePokemon({ is_active: false });
    render(<PokemonCard {...defaultProps} pokemon={inactivePokemon} />);
    expect(screen.queryByTitle("Dieses Pokémon wird von Hotkeys gesteuert")).not.toBeInTheDocument();
  });

  it("shows fallback sprite when sprite_url is empty", () => {
    const pokemon = makePokemon({ sprite_url: "" });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    const img = screen.getByAltText("Bisasam");
    expect(img.getAttribute("src")).toContain("pokemon/0.png");
  });

  it("shows fallback sprite when image fails to load", () => {
    const pokemon = makePokemon({ sprite_url: "http://bad-url.png" });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    const img = screen.getByAltText("Bisasam");
    // Trigger the error handler
    fireEvent.error(img);
    expect(img.getAttribute("src")).toContain("pokemon/0.png");
  });

  it("formats game key for display", () => {
    const pokemon = makePokemon({ game: "pokemon-emerald" });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    expect(screen.getByText("EMERALD")).toBeInTheDocument();
  });

  it("shows Global when game is empty", () => {
    const pokemon = makePokemon({ game: "" });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("formats letsgo game key correctly", () => {
    const pokemon = makePokemon({ game: "pokemon-letsgo-pikachu" });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    expect(screen.getByText("L.G. -PIKACHU")).toBeInTheDocument();
  });

  it("shows detector match indicator when status is match", () => {
    useCounterStore.setState({
      detectorStatus: { "poke-1": { state: "match", confidence: 0.95, poll_ms: 50 } },
    });
    const { container } = render(<PokemonCard {...defaultProps} />);
    const dot = container.querySelector(".bg-green-400");
    expect(dot).toBeInTheDocument();
  });

  it("shows detector cooldown indicator when status is cooldown", () => {
    useCounterStore.setState({
      detectorStatus: { "poke-1": { state: "cooldown", confidence: 0.9, poll_ms: 50 } },
    });
    const { container } = render(<PokemonCard {...defaultProps} />);
    const dot = container.querySelector(".bg-amber-400");
    expect(dot).toBeInTheDocument();
  });

  it("shows detector running indicator with pulse when status is running", () => {
    useCounterStore.setState({
      detectorStatus: { "poke-1": { state: "running", confidence: 0, poll_ms: 50 } },
    });
    const { container } = render(<PokemonCard {...defaultProps} />);
    const dot = container.querySelector(".bg-accent-blue.animate-pulse");
    expect(dot).toBeInTheDocument();
  });

  it("does not show detector indicator when no status entry exists", () => {
    useCounterStore.setState({ detectorStatus: {} });
    const { container } = render(<PokemonCard {...defaultProps} />);
    const greenDot = container.querySelector(".bg-green-400");
    const amberDot = container.querySelector(".bg-amber-400");
    const blueDot = container.querySelector(".bg-accent-blue.animate-pulse");
    expect(greenDot).not.toBeInTheDocument();
    expect(amberDot).not.toBeInTheDocument();
    expect(blueDot).not.toBeInTheDocument();
  });
});
