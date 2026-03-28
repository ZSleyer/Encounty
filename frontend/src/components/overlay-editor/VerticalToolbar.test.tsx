import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { VerticalToolbar } from "./VerticalToolbar";

function makeProps(overrides?: Partial<Parameters<typeof VerticalToolbar>[0]>) {
  return {
    activeTool: "pointer" as const,
    onToolChange: vi.fn(),
    showGrid: false,
    onToggleGrid: vi.fn(),
    snapEnabled: false,
    onToggleSnap: vi.fn(),
    gridSize: 16,
    onGridSizeChange: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onFitToView: vi.fn(),
    canvasBg: "transparent" as const,
    onCanvasBgChange: vi.fn(),
    zoom: 1,
    mousePos: { x: 100, y: 200 },
    activePokemon: true,
    currentCount: 5,
    onTestIncrement: vi.fn(),
    onTestDecrement: vi.fn(),
    onTestReset: vi.fn(),
    onShowTutorial: vi.fn(),
    ...overrides,
  };
}

describe("VerticalToolbar", () => {
  it("renders all tool buttons with aria-labels", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    // Pointer, Hand, Zoom tool buttons
    expect(screen.getByLabelText(/Auswahl-Werkzeug/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Hand-Werkzeug/)).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom (Z)")).toBeInTheDocument();
  });

  it("highlights the active tool", () => {
    const props = makeProps({ activeTool: "hand" });
    render(<VerticalToolbar {...props} />);
    const handBtn = screen.getByLabelText(/Hand-Werkzeug/);
    expect(handBtn.className).toContain("text-accent-blue");
  });

  it("calls onToolChange when tool clicked", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    fireEvent.click(screen.getByLabelText("Zoom (Z)"));
    expect(props.onToolChange).toHaveBeenCalledWith("zoom");
  });

  it("renders grid and snap toggle buttons", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    expect(screen.getByLabelText("Raster ein-/ausblenden")).toBeInTheDocument();
    expect(screen.getByLabelText("Am Raster einrasten")).toBeInTheDocument();
  });

  it("calls onToggleGrid when grid button clicked", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    fireEvent.click(screen.getByLabelText("Raster ein-/ausblenden"));
    expect(props.onToggleGrid).toHaveBeenCalledOnce();
  });

  it("shows grid size selector when grid is visible", () => {
    const props = makeProps({ showGrid: true });
    render(<VerticalToolbar {...props} />);
    expect(screen.getByLabelText("Rastergröße")).toBeInTheDocument();
  });

  it("hides grid size selector when grid is hidden", () => {
    const props = makeProps({ showGrid: false });
    render(<VerticalToolbar {...props} />);
    expect(screen.queryByLabelText("Rastergröße")).not.toBeInTheDocument();
  });

  it("renders undo/redo buttons", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    expect(screen.getByLabelText(/Rückgängig/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Wiederholen/)).toBeInTheDocument();
  });

  it("disables redo when canRedo is false", () => {
    const props = makeProps({ canRedo: false });
    render(<VerticalToolbar {...props} />);
    const redoBtn = screen.getByLabelText(/Wiederholen/);
    expect(redoBtn).toBeDisabled();
  });

  it("calls onUndo when undo button clicked", () => {
    const props = makeProps({ canUndo: true });
    render(<VerticalToolbar {...props} />);
    fireEvent.click(screen.getByLabelText(/Rückgängig/));
    expect(props.onUndo).toHaveBeenCalledOnce();
  });

  it("renders fit to view button", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    expect(screen.getByLabelText("Ansicht anpassen")).toBeInTheDocument();
  });

  it("renders test increment/decrement/reset buttons", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    expect(screen.getByLabelText("Vorschau: Zähler erhöhen")).toBeInTheDocument();
    expect(screen.getByLabelText("Vorschau: Zähler verringern")).toBeInTheDocument();
    expect(screen.getByLabelText("Vorschau: Zähler zurücksetzen")).toBeInTheDocument();
  });

  it("calls onTestIncrement when + button clicked", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    fireEvent.click(screen.getByLabelText("Vorschau: Zähler erhöhen"));
    expect(props.onTestIncrement).toHaveBeenCalledOnce();
  });

  it("renders canvas background toggle buttons", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    expect(screen.getByLabelText("Transparenter Hintergrund")).toBeInTheDocument();
    expect(screen.getByLabelText("Weißer Hintergrund")).toBeInTheDocument();
    expect(screen.getByLabelText("Schwarzer Hintergrund")).toBeInTheDocument();
  });

  it("renders zoom level and mouse position", () => {
    const props = makeProps({ zoom: 1.5, mousePos: { x: 42, y: 99 } });
    render(<VerticalToolbar {...props} />);
    expect(screen.getByText("X:42")).toBeInTheDocument();
    expect(screen.getByText("Y:99")).toBeInTheDocument();
    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  it("renders tutorial help button", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    expect(screen.getByLabelText("Tutorial anzeigen")).toBeInTheDocument();
  });

  it("calls onShowTutorial when help button clicked", () => {
    const props = makeProps();
    render(<VerticalToolbar {...props} />);
    fireEvent.click(screen.getByLabelText("Tutorial anzeigen"));
    expect(props.onShowTutorial).toHaveBeenCalledOnce();
  });
});
