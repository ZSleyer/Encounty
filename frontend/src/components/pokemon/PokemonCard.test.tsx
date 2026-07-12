import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, makePokemon } from "../../test-utils";
import { PokemonCard } from "./PokemonCard";
import { useCounterStore } from "../../hooks/useCounterState";
import type { DetectorConfig } from "../../types";
import { SPRITE_FALLBACK } from "../../utils/sprites";

// Controllable capture service so preview-related branches can be exercised.
const captureState = vi.hoisted(() => ({
  capturing: new Set<string>(),
  stream: null as MediaStream | null,
}));

vi.mock("../../contexts/CaptureServiceContext", () => ({
  CaptureServiceProvider: ({ children }: { children: React.ReactNode }) => children,
  useCaptureService: () => ({
    isCapturing: (id: string) => captureState.capturing.has(id),
    getStream: () => captureState.stream,
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
  }),
  useCaptureVersion: () => 0,
}));

/** Minimal DetectorConfig fixture for preview tests. */
function makeDetectorConfig(overrides?: Partial<DetectorConfig>): DetectorConfig {
  return {
    enabled: false,
    source_type: "browser_display",
    region: { x: 0, y: 0, w: 1920, h: 1080 },
    window_title: "",
    templates: [],
    change_threshold: 0.15,
    ...overrides,
  };
}

beforeEach(() => {
  captureState.capturing.clear();
  captureState.stream = null;
  globalThis.MediaStream ??= class MockMediaStream {
    getTracks() { return []; }
    getVideoTracks() { return []; }
  } as unknown as typeof MediaStream;
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

describe("PokemonCard", () => {
  const defaultProps = {
    pokemon: makePokemon(),
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
    onReset: vi.fn(),
    onEdit: vi.fn(),
    onOpenDetector: vi.fn(),
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
    // Non-box style: renders a plain <img> synchronously instead of routing
    // through TrimmedBoxSprite's async canvas-trim pipeline.
    const pokemon = makePokemon({ sprite_url: "", sprite_style: "artwork" });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    const img = screen.getByAltText("Bisasam");
    expect(img.getAttribute("src")).toBe(SPRITE_FALLBACK);
  });

  it("shows fallback sprite when image fails to load", () => {
    const pokemon = makePokemon({ sprite_url: "http://bad-url.png", sprite_style: "artwork" });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    const img = screen.getByAltText("Bisasam");
    // Trigger the error handler
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe(SPRITE_FALLBACK);
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
    const dot = container.querySelector(".bg-green-500");
    expect(dot).toBeInTheDocument();
  });

  it("shows detector cooldown indicator when status is cooldown", () => {
    useCounterStore.setState({
      detectorStatus: { "poke-1": { state: "cooldown", confidence: 0.9, poll_ms: 50 } },
    });
    const { container } = render(<PokemonCard {...defaultProps} />);
    const dot = container.querySelector(".bg-purple-500");
    expect(dot).toBeInTheDocument();
  });

  it("shows detector running indicator with pulse when status is running", () => {
    useCounterStore.setState({
      detectorStatus: { "poke-1": { state: "running", confidence: 0, poll_ms: 50 } },
    });
    const { container } = render(<PokemonCard {...defaultProps} />);
    const dot = container.querySelector(".bg-blue-400.animate-pulse");
    expect(dot).toBeInTheDocument();
  });

  it("does not show detector indicator when no status entry exists", () => {
    useCounterStore.setState({ detectorStatus: {} });
    const { container } = render(<PokemonCard {...defaultProps} />);
    const greenDot = container.querySelector(".bg-green-500");
    const purpleDot = container.querySelector(".bg-purple-500");
    const blueDot = container.querySelector(".bg-blue-400.animate-pulse");
    expect(greenDot).not.toBeInTheDocument();
    expect(purpleDot).not.toBeInTheDocument();
    expect(blueDot).not.toBeInTheDocument();
  });

  // --- Live source preview ---

  it("shows the detector's own 'no source' placeholder and a disabled preview button when nothing is streaming", () => {
    render(<PokemonCard {...defaultProps} />);
    expect(screen.getByText("Keine Verbindung")).toBeInTheDocument();
    expect(screen.getByText("Live-Vorschau")).toHaveClass("invisible");
    expect(screen.getByLabelText("Keine Quelle verbunden")).toBeDisabled();
  });

  it("shows the live preview label and an enabled preview button when a source is streaming", () => {
    captureState.capturing.add("poke-1");
    const pokemon = makePokemon({ id: "poke-1", detector_config: makeDetectorConfig() });
    render(<PokemonCard {...defaultProps} pokemon={pokemon} />);
    expect(screen.getByText("Live-Vorschau")).not.toHaveClass("invisible");
    expect(screen.getByLabelText("Auto-Erkennung öffnen")).toBeEnabled();
  });

  it("opens auto-detection when the preview is clicked", async () => {
    captureState.capturing.add("poke-1");
    captureState.stream = new MediaStream();
    const onOpenDetector = vi.fn();
    const pokemon = makePokemon({ id: "poke-1", detector_config: makeDetectorConfig() });
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<PokemonCard {...defaultProps} pokemon={pokemon} onOpenDetector={onOpenDetector} />);

    await user.click(screen.getByLabelText("Auto-Erkennung öffnen"));
    expect(onOpenDetector).toHaveBeenCalledWith("poke-1");
  });
});
