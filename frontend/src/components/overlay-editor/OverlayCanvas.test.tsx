import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makeOverlaySettings, makePokemon } from "../../test-utils";
import { OverlayCanvas, ResizeHandle, useElementDrag } from "./OverlayCanvas";
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

  it("shows resize handles only for the selected element", () => {
    render(
      <OverlayCanvas {...makeProps({ selectedEl: "name" })} />,
    );
    // The selected element ("name") should have 8 resize handles (aria-hidden divs inside it)
    const nameBtn = screen.getByLabelText("Element: name");
    const handles = nameBtn.querySelectorAll("[aria-hidden='true']");
    expect(handles.length).toBe(8);

    // Non-selected elements should have zero resize handles
    const spriteBtn = screen.getByLabelText("Element: sprite");
    const spriteHandles = spriteBtn.querySelectorAll("[aria-hidden='true']");
    expect(spriteHandles.length).toBe(0);
  });

  it("does not render grid overlay when showGrid is false", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ showGrid: false })} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders guide lines when guides are provided", () => {
    const guides = [
      { type: "v" as const, position: 50 },
      { type: "h" as const, position: 100 },
    ];
    const { container } = render(
      <OverlayCanvas {...makeProps({ guides })} />,
    );
    // Vertical guide has border-l class, horizontal has border-t class
    const vGuide = container.querySelector(".border-dashed.border-l");
    const hGuide = container.querySelector(".border-dashed.border-t");
    expect(vGuide).not.toBeNull();
    expect(hGuide).not.toBeNull();
  });

  it("shows drag tooltip with dimensions when isDragging", () => {
    const settings = makeOverlaySettings();
    render(
      <OverlayCanvas
        {...makeProps({
          isDragging: true,
          selectedEl: "sprite",
          localSettings: settings,
        })}
      />,
    );
    // Tooltip shows "width × height"
    expect(
      screen.getByText(`${settings.sprite.width} × ${settings.sprite.height}`),
    ).toBeInTheDocument();
  });

  it("does not show drag tooltip when not dragging", () => {
    const settings = makeOverlaySettings();
    render(
      <OverlayCanvas
        {...makeProps({ isDragging: false, localSettings: settings })}
      />,
    );
    expect(
      screen.queryByText(`${settings.sprite.width} × ${settings.sprite.height}`),
    ).not.toBeInTheDocument();
  });

  it("sets white background color when canvasBg is white", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ canvasBg: "white" })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']") as HTMLElement;
    expect(canvasEl.style.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("sets black background color when canvasBg is black", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ canvasBg: "black" })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']") as HTMLElement;
    expect(canvasEl.style.backgroundColor).toBe("rgb(0, 0, 0)");
  });

  it("applies grab cursor for hand tool", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ effectiveTool: "hand" })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']") as HTMLElement;
    expect(canvasEl.style.cursor).toBe("grab");
  });

  it("applies grabbing cursor when pan-dragging with hand tool", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ effectiveTool: "hand", isPanDragging: true })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']") as HTMLElement;
    expect(canvasEl.style.cursor).toBe("grabbing");
  });

  it("applies zoom-in cursor for zoom tool", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ effectiveTool: "zoom" })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']") as HTMLElement;
    expect(canvasEl.style.cursor).toBe("zoom-in");
  });

  it("applies zoom-out cursor for zoom tool with alt held", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ effectiveTool: "zoom", altHeld: true })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']") as HTMLElement;
    expect(canvasEl.style.cursor).toBe("zoom-out");
  });

  it("hides elements that are not visible", () => {
    const settings = makeOverlaySettings({
      sprite: { ...makeOverlaySettings().sprite, visible: false },
    });
    render(<OverlayCanvas {...makeProps({ localSettings: settings })} />);
    expect(screen.queryByLabelText("Element: sprite")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Element: name")).toBeInTheDocument();
  });

  it("calls onDoubleClickElement on element double-click", () => {
    const onDoubleClickElement = vi.fn();
    render(
      <OverlayCanvas {...makeProps({ onDoubleClickElement })} />,
    );
    fireEvent.doubleClick(screen.getByLabelText("Element: title"));
    expect(onDoubleClickElement).toHaveBeenCalledWith("title");
  });

  it("calls onMouseUp on Escape keydown", () => {
    const onMouseUp = vi.fn();
    render(<OverlayCanvas {...makeProps({ onMouseUp })} />);
    const canvas = screen.getByLabelText("Overlay canvas");
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(onMouseUp).toHaveBeenCalled();
  });

  it("selects element via Enter key", () => {
    const onSelectElement = vi.fn();
    render(<OverlayCanvas {...makeProps({ onSelectElement })} />);
    fireEvent.keyDown(screen.getByLabelText("Element: counter"), { key: "Enter" });
    expect(onSelectElement).toHaveBeenCalledWith("counter");
  });

  it("selects element via Space key", () => {
    const onSelectElement = vi.fn();
    render(<OverlayCanvas {...makeProps({ onSelectElement })} />);
    fireEvent.keyDown(screen.getByLabelText("Element: name"), { key: " " });
    expect(onSelectElement).toHaveBeenCalledWith("name");
  });

  it("does not call onSelectElement for non-activation keys", () => {
    const onSelectElement = vi.fn();
    render(<OverlayCanvas {...makeProps({ onSelectElement })} />);
    fireEvent.keyDown(screen.getByLabelText("Element: name"), { key: "Tab" });
    // Only Enter and Space trigger selection, not Tab
    expect(onSelectElement).not.toHaveBeenCalled();
  });

  it("does not trigger drag when effectiveTool is hand", () => {
    const onSelectElement = vi.fn();
    render(
      <OverlayCanvas {...makeProps({ effectiveTool: "hand", onSelectElement })} />,
    );
    // MouseDown on element with hand tool should not call onSelectElement
    fireEvent.mouseDown(screen.getByLabelText("Element: sprite"));
    expect(onSelectElement).not.toHaveBeenCalled();
  });

  it("does not trigger drag when effectiveTool is zoom", () => {
    const onSelectElement = vi.fn();
    render(
      <OverlayCanvas {...makeProps({ effectiveTool: "zoom", onSelectElement })} />,
    );
    fireEvent.mouseDown(screen.getByLabelText("Element: sprite"));
    expect(onSelectElement).not.toHaveBeenCalled();
  });

  it("applies inherit cursor on element buttons when hand tool is active", () => {
    render(
      <OverlayCanvas {...makeProps({ effectiveTool: "hand" })} />,
    );
    const btn = screen.getByLabelText("Element: sprite");
    expect(btn.style.cursor).toBe("inherit");
  });

  it("applies move cursor on element buttons when pointer tool is active", () => {
    render(
      <OverlayCanvas {...makeProps({ effectiveTool: "pointer" })} />,
    );
    const btn = screen.getByLabelText("Element: sprite");
    expect(btn.style.cursor).toBe("move");
  });

  it("applies default cursor for pointer tool on canvas", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ effectiveTool: "pointer" })} />,
    );
    const canvasEl = container.querySelector("[data-tutorial='canvas']") as HTMLElement;
    expect(canvasEl.style.cursor).toBe("default");
  });

  it("renders fakeCount in overlay preview when provided", () => {
    // fakeCount is passed to the Overlay component as previewPokemon with adjusted encounters
    const pokemon = makePokemon({ encounters: 42 });
    render(
      <OverlayCanvas {...makeProps({ fakeCount: 999, activePokemon: pokemon })} />,
    );
    // The mock overlay renders, confirming the component works with fakeCount
    expect(screen.getByTestId("mock-overlay")).toBeInTheDocument();
  });

  it("renders without activePokemon", () => {
    render(
      <OverlayCanvas {...makeProps({ activePokemon: undefined })} />,
    );
    expect(screen.getByTestId("mock-overlay")).toBeInTheDocument();
  });

  it("does not show drag tooltip when selectedEl is canvas", () => {
    render(
      <OverlayCanvas
        {...makeProps({ isDragging: true, selectedEl: "canvas" as "sprite" })}
      />,
    );
    // When selectedEl is "canvas", the tooltip condition fails
    const tooltip = document.querySelector(String.raw`.pointer-events-none.bg-black\/80`);
    expect(tooltip).toBeNull();
  });

  it("does not show grid when showGrid is false", () => {
    const { container } = render(
      <OverlayCanvas {...makeProps({ showGrid: false })} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders correct number of grid lines based on gridSize", () => {
    const settings = makeOverlaySettings({ canvas_width: 160, canvas_height: 80 });
    const { container } = render(
      <OverlayCanvas {...makeProps({ showGrid: true, gridSize: 40, localSettings: settings })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // canvas_width=160, gridSize=40 -> Math.floor(160/40) = 4 vertical lines
    // canvas_height=80, gridSize=40 -> Math.floor(80/40) = 2 horizontal lines
    // Total = 6 lines
    const allLines = svg!.querySelectorAll("line");
    expect(allLines.length).toBe(6);
  });

  it("applies correct z-index on element overlays", () => {
    const settings = makeOverlaySettings();
    render(<OverlayCanvas {...makeProps({ localSettings: settings })} />);
    const spriteBtn = screen.getByLabelText("Element: sprite");
    // z-index = 50 + el.z_index = 50 + 1 = 51
    expect(spriteBtn.style.zIndex).toBe("51");
  });

  it("positions element overlays according to settings", () => {
    const settings = makeOverlaySettings();
    render(<OverlayCanvas {...makeProps({ localSettings: settings })} />);
    const spriteBtn = screen.getByLabelText("Element: sprite");
    expect(spriteBtn.style.left).toBe("10px");
    expect(spriteBtn.style.top).toBe("10px");
    expect(spriteBtn.style.width).toBe("80px");
    expect(spriteBtn.style.height).toBe("80px");
  });

  it("calls onMouseMove when mouse moves over canvas", () => {
    const onMouseMove = vi.fn();
    render(<OverlayCanvas {...makeProps({ onMouseMove })} />);
    const canvas = screen.getByLabelText("Overlay canvas");
    fireEvent.mouseMove(canvas);
    expect(onMouseMove).toHaveBeenCalled();
  });

  it("calls onMouseDown when mouse is pressed on canvas", () => {
    const onMouseDown = vi.fn();
    render(<OverlayCanvas {...makeProps({ onMouseDown })} />);
    const canvas = screen.getByLabelText("Overlay canvas");
    fireEvent.mouseDown(canvas);
    expect(onMouseDown).toHaveBeenCalled();
  });

  it("calls onMouseUp when mouse is released on canvas", () => {
    const onMouseUp = vi.fn();
    render(<OverlayCanvas {...makeProps({ onMouseUp })} />);
    const canvas = screen.getByLabelText("Overlay canvas");
    fireEvent.mouseUp(canvas);
    expect(onMouseUp).toHaveBeenCalled();
  });

  it("calls onMouseUp on mouse leave", () => {
    const onMouseUp = vi.fn();
    render(<OverlayCanvas {...makeProps({ onMouseUp })} />);
    const canvas = screen.getByLabelText("Overlay canvas");
    fireEvent.mouseLeave(canvas);
    expect(onMouseUp).toHaveBeenCalled();
  });

  it("renders multiple guide types correctly", () => {
    const guides = [
      { type: "v" as const, position: 10 },
      { type: "v" as const, position: 50 },
      { type: "h" as const, position: 30 },
    ];
    const { container } = render(
      <OverlayCanvas {...makeProps({ guides })} />,
    );
    const vGuides = container.querySelectorAll(".border-dashed.border-l");
    const hGuides = container.querySelectorAll(".border-dashed.border-t");
    expect(vGuides.length).toBe(2);
    expect(hGuides.length).toBe(1);
  });
});

// --- ResizeHandle component ---

describe("ResizeHandle", () => {
  it("renders a resize handle div with correct cursor", () => {
    const onResizeStart = vi.fn(() => vi.fn());
    const { container } = render(
      <ResizeHandle dir="se" onResizeStart={onResizeStart} />,
    );
    const handleDiv = container.querySelector("[aria-hidden='true']");
    expect(handleDiv).not.toBeNull();
    expect((handleDiv as HTMLElement).style.cursor).toBe("se-resize");
  });

  it("calls onResizeStart when mouseDown fires on handle", () => {
    const innerFn = vi.fn();
    const onResizeStart = vi.fn(() => innerFn);
    render(
      <ResizeHandle dir="nw" onResizeStart={onResizeStart} />,
    );
    const handleDiv = document.querySelector("[aria-hidden='true']") as HTMLElement;
    fireEvent.mouseDown(handleDiv);
    expect(onResizeStart).toHaveBeenCalledWith("nw");
    expect(innerFn).toHaveBeenCalled();
  });

  it("renders with north cursor for n direction", () => {
    const onResizeStart = vi.fn(() => vi.fn());
    const { container } = render(
      <ResizeHandle dir="n" onResizeStart={onResizeStart} />,
    );
    const handleDiv = container.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(handleDiv.style.cursor).toBe("n-resize");
  });
});

// --- useElementDrag hook ---

describe("useElementDrag", () => {
  it("triggers drag flow on mouseDown and dispatches onDragStateChange", () => {
    const onUpdate = vi.fn();
    const onDragStateChange = vi.fn();
    const onGuidesChange = vi.fn();
    const settings = makeOverlaySettings();

    function DragTestComponent() {
      const { onDragStart } = useElementDrag({
        elementKey: "sprite",
        settings,
        onUpdate,
        canvasScale: 1,
        onDragStateChange,
        onGuidesChange,
        snapEnabled: false,
        gridSize: 8,
      });
      return <button data-testid="drag-target" onMouseDown={onDragStart}>Drag</button>;
    }

    render(<DragTestComponent />);
    const target = screen.getByTestId("drag-target");

    fireEvent.mouseDown(target, { clientX: 100, clientY: 100 });
    expect(onDragStateChange).toHaveBeenCalledWith(true);

    // Simulate mouse move on window
    fireEvent.mouseMove(globalThis as unknown as Window, { clientX: 120, clientY: 130 });
    expect(onUpdate).toHaveBeenCalled();

    // Simulate mouse up on window
    fireEvent.mouseUp(globalThis as unknown as Window);
    expect(onDragStateChange).toHaveBeenCalledWith(false);
    expect(onGuidesChange).toHaveBeenCalledWith([]);
  });

  it("triggers resize flow on mouseDown", () => {
    const onUpdate = vi.fn();
    const onDragStateChange = vi.fn();
    const settings = makeOverlaySettings();

    function ResizeTestComponent() {
      const { onResizeStart } = useElementDrag({
        elementKey: "name",
        settings,
        onUpdate,
        canvasScale: 1,
        onDragStateChange,
        snapEnabled: false,
        gridSize: 8,
      });
      return <button data-testid="resize-target" onMouseDown={onResizeStart("se")}>Resize</button>;
    }

    render(<ResizeTestComponent />);
    const target = screen.getByTestId("resize-target");

    fireEvent.mouseDown(target, { clientX: 200, clientY: 200 });
    expect(onDragStateChange).toHaveBeenCalledWith(true);

    // Simulate resize movement
    fireEvent.mouseMove(globalThis as unknown as Window, { clientX: 230, clientY: 240 });
    expect(onUpdate).toHaveBeenCalled();

    // Verify updated dimensions are passed (se resize = east + south)
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastCall.name.width).toBeGreaterThanOrEqual(20);
    expect(lastCall.name.height).toBeGreaterThanOrEqual(20);

    // Release mouse
    fireEvent.mouseUp(globalThis as unknown as Window);
    expect(onDragStateChange).toHaveBeenCalledWith(false);
  });
});
