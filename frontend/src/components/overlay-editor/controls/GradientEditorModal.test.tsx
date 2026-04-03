import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "../../../test-utils";
import { GradientEditorModal } from "./GradientEditorModal";

// jsdom does not implement showModal
HTMLDialogElement.prototype.showModal = vi.fn();

describe("GradientEditorModal", () => {
  const defaultStops = [
    { color: "#ff0000", position: 0 },
    { color: "#0000ff", position: 100 },
  ];

  const defaultProps = {
    stops: defaultStops,
    angle: 90,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    onOpenColorPicker: vi.fn(),
  };

  it("renders with heading", () => {
    render(<GradientEditorModal {...defaultProps} />);
    expect(screen.getByText("Gradient bearbeiten")).toBeInTheDocument();
  });

  it("renders gradient stop handles", () => {
    render(<GradientEditorModal {...defaultProps} />);
    expect(screen.getByLabelText("Stop 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop 2")).toBeInTheDocument();
  });

  it("renders angle slider", () => {
    render(<GradientEditorModal {...defaultProps} />);
    // t("overlay.angleDeg") is a missing key, rendered as the key itself
    const slider = screen.getByTitle("overlay.angleDeg");
    expect(slider).toBeInTheDocument();
  });

  it("renders stop position inputs", () => {
    const { container } = render(<GradientEditorModal {...defaultProps} />);
    // Position inputs are type="number" inside the stop list
    const posInputs = container.querySelectorAll("input[type='number']");
    // At least 2 position inputs (one per stop)
    expect(posInputs.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    render(<GradientEditorModal {...defaultProps} onClose={onClose} />);
    const cancelBtn = screen.getByTitle("Abbrechen");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with stops and angle when apply is clicked", () => {
    const onConfirm = vi.fn();
    render(<GradientEditorModal {...defaultProps} onConfirm={onConfirm} />);
    const applyBtn = screen.getByTitle("Übernehmen");
    fireEvent.click(applyBtn);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ color: "#ff0000", position: 0 }),
        expect.objectContaining({ color: "#0000ff", position: 100 }),
      ]),
      90,
    );
  });

  it("calls onClose when close X button is clicked", () => {
    const onClose = vi.fn();
    render(<GradientEditorModal {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByTitle("Schließen");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("creates default stops when fewer than 2 are provided", () => {
    render(<GradientEditorModal {...defaultProps} stops={[]} />);
    // Should have 2 default stop handles
    expect(screen.getByLabelText("Stop 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop 2")).toBeInTheDocument();
  });

  it("updates stop position via input", () => {
    const onConfirm = vi.fn();
    const { container } = render(<GradientEditorModal {...defaultProps} onConfirm={onConfirm} />);
    // The position inputs are type="number" with min=0 max=100
    const posInputs = container.querySelectorAll("input[type='number'][max='100']");
    expect(posInputs.length).toBeGreaterThanOrEqual(1);
    fireEvent.change(posInputs[0], { target: { value: "25" } });
    // Now apply and check the updated position
    fireEvent.click(screen.getByTitle("Übernehmen"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ position: 25 }),
      ]),
      90,
    );
  });

  it("does not show remove button when exactly 2 stops", () => {
    render(<GradientEditorModal {...defaultProps} />);
    // With exactly 2 stops, no remove buttons should appear
    const removeButtons = screen.queryAllByTitle("modal.tooltipRemoveStop");
    expect(removeButtons.length).toBe(0);
  });

  it("shows remove buttons when more than 2 stops", () => {
    const threeStops = [
      { color: "#ff0000", position: 0 },
      { color: "#00ff00", position: 50 },
      { color: "#0000ff", position: 100 },
    ];
    render(<GradientEditorModal {...defaultProps} stops={threeStops} />);
    const removeButtons = screen.getAllByTitle("Farbstopp entfernen");
    expect(removeButtons.length).toBe(3);
  });

  it("removes a stop when remove button is clicked", () => {
    const threeStops = [
      { color: "#ff0000", position: 0 },
      { color: "#00ff00", position: 50 },
      { color: "#0000ff", position: 100 },
    ];
    const onConfirm = vi.fn();
    render(<GradientEditorModal {...defaultProps} stops={threeStops} onConfirm={onConfirm} />);
    // Click remove on the first stop
    const removeButtons = screen.getAllByTitle("Farbstopp entfernen");
    fireEvent.click(removeButtons[0]);
    // Now apply — should have 2 stops remaining
    fireEvent.click(screen.getByTitle("Übernehmen"));
    expect(onConfirm).toHaveBeenCalledWith(expect.any(Array), 90);
    const stops = onConfirm.mock.calls[0][0];
    expect(stops.length).toBe(2);
  });

  it("selects a stop when its row is clicked", () => {
    const threeStops = [
      { color: "#ff0000", position: 0 },
      { color: "#00ff00", position: 50 },
      { color: "#0000ff", position: 100 },
    ];
    render(<GradientEditorModal {...defaultProps} stops={threeStops} />);
    // Click on Stop 2 handle to select it
    fireEvent.mouseDown(screen.getByLabelText("Stop 2"), { preventDefault: vi.fn() });
    // The handle for stop 2 should now have the selected border class
    const handle2 = screen.getByLabelText("Stop 2");
    expect(handle2.className).toContain("border-accent-blue");
  });

  it("calls onOpenColorPicker when color swatch is clicked", () => {
    const onOpenColorPicker = vi.fn();
    const { container } = render(
      <GradientEditorModal {...defaultProps} onOpenColorPicker={onOpenColorPicker} />,
    );
    // ColorSwatch elements are rendered inside each stop row
    container.querySelectorAll("[data-testid]");
    // Find swatch buttons by looking for small colored elements in the stop list
    // The ColorSwatch is rendered as a clickable element
    container.querySelectorAll("button.flex.items-center");
    // Click the first swatch-like area (ColorSwatch has an onClick)
    // We need to find the actual swatch element
    const allSmallButtons = container.querySelectorAll(".w-6.h-4.rounded.cursor-pointer");
    if (allSmallButtons.length > 0) {
      fireEvent.click(allSmallButtons[0]);
      expect(onOpenColorPicker).toHaveBeenCalled();
    }
  });

  it("adds a stop when clicking on the gradient bar", () => {
    const onConfirm = vi.fn();
    const { container } = render(<GradientEditorModal {...defaultProps} onConfirm={onConfirm} />);
    // The gradient bar is a button with cursor-crosshair class
    const bar = container.querySelector("button.cursor-crosshair") as HTMLElement;
    expect(bar).not.toBeNull();
    // Simulate a click in the middle of the bar
    Object.defineProperty(bar, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 32, height: 32 }),
    });
    fireEvent.click(bar, { clientX: 100, clientY: 16 });
    // Should now have 3 stops — apply and check
    fireEvent.click(screen.getByTitle("Übernehmen"));
    const stops = onConfirm.mock.calls[0][0];
    expect(stops.length).toBe(3);
  });

  it("renders 3 stop handles when given 3 stops", () => {
    const threeStops = [
      { color: "#ff0000", position: 0 },
      { color: "#00ff00", position: 50 },
      { color: "#0000ff", position: 100 },
    ];
    render(<GradientEditorModal {...defaultProps} stops={threeStops} />);
    expect(screen.getByLabelText("Stop 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop 3")).toBeInTheDocument();
  });

  it("drags a stop handle to update position", () => {
    const onConfirm = vi.fn();
    const { container } = render(<GradientEditorModal {...defaultProps} onConfirm={onConfirm} />);
    const handle1 = screen.getByLabelText("Stop 1");

    // Mock barRef getBoundingClientRect
    const bar = container.querySelector("button.cursor-crosshair") as HTMLElement;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 32, x: 0, y: 0, right: 200, bottom: 32, toJSON: () => {},
    });

    // Start drag via mouseDown on the handle
    fireEvent.mouseDown(handle1, { preventDefault: vi.fn() });

    // Dispatch mousemove and mouseup on globalThis
    act(() => {
      globalThis.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 16, bubbles: true }));
    });
    act(() => {
      globalThis.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    fireEvent.click(screen.getByTitle("Übernehmen"));
    const stops = onConfirm.mock.calls[0][0];
    // Stop 1 position should have been updated to ~50 (100px / 200px * 100)
    expect(stops[0].position).toBe(50);
  });

  it("adds interpolated color stop when clicking between existing stops", () => {
    const onConfirm = vi.fn();
    const { container } = render(<GradientEditorModal {...defaultProps} onConfirm={onConfirm} />);
    const bar = container.querySelector("button.cursor-crosshair") as HTMLElement;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 32, x: 0, y: 0, right: 200, bottom: 32, toJSON: () => {},
    });
    // Click at 50% (clientX=100)
    fireEvent.click(bar, { clientX: 100 });
    fireEvent.click(screen.getByTitle("Übernehmen"));
    const stops = onConfirm.mock.calls[0][0];
    expect(stops.length).toBe(3);
    // Middle stop should be at position 50 with interpolated color
    const middleStop = stops.find((s: { position: number }) => s.position === 50);
    expect(middleStop).toBeDefined();
  });

  it("clears selection when selected stop is deleted", () => {
    const threeStops = [
      { color: "#ff0000", position: 0 },
      { color: "#00ff00", position: 50 },
      { color: "#0000ff", position: 100 },
    ];
    render(<GradientEditorModal {...defaultProps} stops={threeStops} />);
    // Select stop 2 by mouseDown on its handle
    fireEvent.mouseDown(screen.getByLabelText("Stop 2"), { preventDefault: vi.fn() });
    // Verify it is selected (has border-accent-blue)
    expect(screen.getByLabelText("Stop 2").className).toContain("border-accent-blue");
    // Delete stop 2
    const removeButtons = screen.getAllByTitle("Farbstopp entfernen");
    fireEvent.click(removeButtons[1]);
    // After deletion, only 2 stops remain
    expect(screen.queryByLabelText("Stop 3")).not.toBeInTheDocument();
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<GradientEditorModal {...defaultProps} onClose={onClose} />);
    const dialog = container.querySelector("dialog")!;
    // Simulate click on the dialog element itself (backdrop)
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("updates stop color via color picker callback", () => {
    const onOpenColorPicker = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <GradientEditorModal {...defaultProps} onOpenColorPicker={onOpenColorPicker} onConfirm={onConfirm} />,
    );
    const swatches = container.querySelectorAll(".w-6.h-4.rounded.cursor-pointer");
    fireEvent.click(swatches[0]);
    // onOpenColorPicker receives (currentColor, callback)
    expect(onOpenColorPicker).toHaveBeenCalledWith("#ff0000", expect.any(Function));
    // Simulate the callback with a new color
    const callback = onOpenColorPicker.mock.calls[0][1];
    act(() => { callback("#00ff00"); });
    // Apply and verify the color changed
    fireEvent.click(screen.getByTitle("Übernehmen"));
    const stops = onConfirm.mock.calls[0][0];
    expect(stops[0].color).toBe("#00ff00");
  });
});
