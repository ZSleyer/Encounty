import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makeOverlaySettings, makePokemon } from "../../test-utils";
import { OverlayCanvas } from "./OverlayCanvas";
import { createRef } from "react";

// Mock the Overlay page component to avoid heavy rendering
vi.mock("../../pages/Overlay", () => ({
  Overlay: () => <div data-testid="mock-overlay">Overlay Preview</div>,
}));

// Mock useSnapping since it depends on canvas geometry
vi.mock("../../hooks/useSnapping", () => ({
  useSnapping: () => ({
    snap: (x: number, y: number) => ({ x, y }),
    getGuides: () => [],
  }),
}));

function makeProps(overrides?: Record<string, unknown>) {
  const containerRef = createRef<HTMLDivElement>();
  return {
    localSettings: makeOverlaySettings(),
    selectedEl: "sprite" as const,
    effectiveScale: 1,
    showGrid: false,
    gridSize: 16,
    snapEnabled: false,
    guides: [],
    isDragging: false,
    effectiveTool: "pointer" as const,
    isPanDragging: false,
    canvasBg: "transparent" as const,
    testTrigger: { element: "sprite" as const, n: 0 },
    fakeCount: null,
    activePokemon: makePokemon(),
    canvasContainerRef: containerRef,
    onMouseMove: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseUp: vi.fn(),
    onSelectElement: vi.fn(),
    onDragStateChange: vi.fn(),
    onGuidesChange: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  };
}

describe("OverlayCanvas", () => {
  it("renders without crashing", () => {
    const { container } = render(<OverlayCanvas {...makeProps()} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders the mocked overlay preview", () => {
    render(<OverlayCanvas {...makeProps()} />);
    expect(screen.getByTestId("mock-overlay")).toBeInTheDocument();
  });

  it("renders element overlay buttons for visible elements", () => {
    render(<OverlayCanvas {...makeProps()} />);
    expect(screen.getByLabelText("Element: sprite")).toBeInTheDocument();
    expect(screen.getByLabelText("Element: name")).toBeInTheDocument();
    expect(screen.getByLabelText("Element: title")).toBeInTheDocument();
    expect(screen.getByLabelText("Element: counter")).toBeInTheDocument();
  });

  it("calls onSelectElement when element button is clicked", () => {
    const onSelectElement = vi.fn();
    render(<OverlayCanvas {...makeProps({ onSelectElement })} />);
    // mouseDown on an element triggers onSelectElement
    fireEvent.mouseDown(screen.getByLabelText("Element: name"));
    expect(onSelectElement).toHaveBeenCalledWith("name");
  });

  it("applies canvas-checkered class for transparent background", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ canvasBg: "transparent" })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']");
    expect(canvasEl?.className).toContain("canvas-checkered");
  });

  it("does not apply checkered class for non-transparent backgrounds", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ canvasBg: "black" })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']");
    expect(canvasEl?.className).not.toContain("canvas-checkered");
  });

  it("hides element overlays when readOnly is true", () => {
    render(<OverlayCanvas {...makeProps({ readOnly: true })} />);
    expect(screen.queryByLabelText("Element: sprite")).not.toBeInTheDocument();
  });

  it("renders grid overlay when showGrid is true", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ showGrid: true })} />,
    );
    const svgGrid = container.querySelector("svg");
    expect(svgGrid).not.toBeNull();
  });

  it("has correct aria-label on the canvas container", () => {
    render(<OverlayCanvas {...makeProps()} />);
    expect(screen.getByLabelText("Overlay canvas")).toBeInTheDocument();
  });
});
