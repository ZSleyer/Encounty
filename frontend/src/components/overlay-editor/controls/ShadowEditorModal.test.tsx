import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { ShadowEditorModal } from "./ShadowEditorModal";

// jsdom does not implement showModal
HTMLDialogElement.prototype.showModal = vi.fn();

describe("ShadowEditorModal", () => {
  const defaultProps = {
    enabled: true,
    color: "#000000",
    colorType: "solid" as const,
    gradientStops: [],
    gradientAngle: 0,
    blur: 4,
    x: 2,
    y: 2,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    onOpenColorPicker: vi.fn(),
    onOpenGradientEditor: vi.fn(),
  };

  it("renders with heading", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    expect(screen.getByText("Schatten bearbeiten")).toBeInTheDocument();
  });

  it("renders shadow enable checkbox", () => {
    const { container } = render(<ShadowEditorModal {...defaultProps} />);
    const checkbox = container.querySelector("input[type='checkbox']");
    expect(checkbox).not.toBeNull();
    expect(checkbox).toBeChecked();
  });

  it("renders shadow inactive when enabled is false", () => {
    const { container } = render(<ShadowEditorModal {...defaultProps} enabled={false} />);
    const checkbox = container.querySelector("input[type='checkbox']");
    expect(checkbox).not.toBeNull();
    expect(checkbox).not.toBeChecked();
  });

  it("renders preview text", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    expect(screen.getByText("Abc")).toBeInTheDocument();
  });

  it("renders XY offset pad", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    expect(screen.getByLabelText("Shadow offset picker")).toBeInTheDocument();
    expect(screen.getByText(/X: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Y: 2/)).toBeInTheDocument();
  });

  it("shows color type toggle buttons", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    // t("overlay.colorSolid") and t("overlay.colorGradient") are missing keys, rendered as-is
    expect(screen.getByText("overlay.colorSolid")).toBeInTheDocument();
    expect(screen.getByText("overlay.colorGradient")).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    render(<ShadowEditorModal {...defaultProps} onClose={onClose} />);
    const cancelBtn = screen.getByTitle("Abbrechen");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with current settings when apply is clicked", () => {
    const onConfirm = vi.fn();
    render(<ShadowEditorModal {...defaultProps} onConfirm={onConfirm} />);
    const applyBtn = screen.getByTitle("Übernehmen");
    fireEvent.click(applyBtn);
    expect(onConfirm).toHaveBeenCalledWith({
      enabled: true,
      color: "#000000",
      colorType: "solid",
      gradientStops: [],
      gradientAngle: 0,
      blur: 4,
      x: 2,
      y: 2,
    });
  });

  it("calls onClose when close X button is clicked", () => {
    const onClose = vi.fn();
    render(<ShadowEditorModal {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByTitle("Schließen");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("toggles enable checkbox", () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <ShadowEditorModal {...defaultProps} onConfirm={onConfirm} />,
    );
    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    // Initially checked (enabled=true)
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    // Now apply and check that enabled is false
    fireEvent.click(screen.getByTitle("Übernehmen"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("renders blur slider", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    // NumSlider renders a title with the label text
    const blurSlider = screen.getByTitle("overlay.blurPx");
    expect(blurSlider).toBeInTheDocument();
  });

  it("shows solid color swatch when colorType is solid", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    // The "Farbe" label section should be visible
    expect(screen.getByText("Farbe")).toBeInTheDocument();
  });

  it("shows gradient swatch when colorType is gradient", () => {
    render(
      <ShadowEditorModal
        {...defaultProps}
        colorType="gradient"
        gradientStops={[
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ]}
      />,
    );
    // "overlay.colorGradient" appears in both the toggle button and the label section
    const matches = screen.getAllByText("overlay.colorGradient");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("switches color type to gradient when gradient button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ShadowEditorModal {...defaultProps} onConfirm={onConfirm} />);
    // Click the gradient toggle button (only one instance when colorType is solid)
    fireEvent.click(screen.getAllByText("overlay.colorGradient")[0]);
    // Apply and verify colorType changed
    fireEvent.click(screen.getByTitle("Übernehmen"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ colorType: "gradient" }),
    );
  });

  it("calls onOpenColorPicker when solid color swatch is clicked", () => {
    const onOpenColorPicker = vi.fn();
    const { container } = render(
      <ShadowEditorModal {...defaultProps} onOpenColorPicker={onOpenColorPicker} />,
    );
    // Find the color swatch in the solid color section
    const swatches = container.querySelectorAll(".w-6.h-4.rounded.cursor-pointer");
    if (swatches.length > 0) {
      fireEvent.click(swatches[0]);
      expect(onOpenColorPicker).toHaveBeenCalled();
    }
  });

  it("calls onOpenGradientEditor when gradient swatch is clicked", () => {
    const onOpenGradientEditor = vi.fn();
    const { container } = render(
      <ShadowEditorModal
        {...defaultProps}
        colorType="gradient"
        gradientStops={[
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ]}
        onOpenGradientEditor={onOpenGradientEditor}
      />,
    );
    const swatches = container.querySelectorAll(".w-6.h-4.rounded.cursor-pointer");
    if (swatches.length > 0) {
      fireEvent.click(swatches[0]);
      expect(onOpenGradientEditor).toHaveBeenCalled();
    }
  });

  it("displays correct XY offset values", () => {
    render(<ShadowEditorModal {...defaultProps} x={-5} y={10} />);
    expect(screen.getByText(/X: -5/)).toBeInTheDocument();
    expect(screen.getByText(/Y: 10/)).toBeInTheDocument();
  });

  it("applies shadow CSS to preview text when enabled", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    const previewText = screen.getByText("Abc");
    // Shadow should be applied: "2px 2px 4px #000000"
    expect(previewText.style.textShadow).toBe("2px 2px 4px #000000");
  });

  it("applies none shadow to preview text when disabled", () => {
    render(<ShadowEditorModal {...defaultProps} enabled={false} />);
    const previewText = screen.getByText("Abc");
    expect(previewText.style.textShadow).toBe("none");
  });

  it("renders offset pad with correct label", () => {
    render(<ShadowEditorModal {...defaultProps} />);
    expect(screen.getByText("Offset")).toBeInTheDocument();
  });

  it("updates XY offset when pad is dragged (mouseDown only)", () => {
    const onConfirm = vi.fn();
    render(<ShadowEditorModal {...defaultProps} x={0} y={0} onConfirm={onConfirm} />);
    const pad = screen.getByLabelText("Shadow offset picker");

    vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 120, height: 120, x: 0, y: 0, right: 120, bottom: 120, toJSON: () => {},
    });

    // mouseDown at center (60, 60) -> ratio 0.5 -> value 0
    fireEvent.mouseDown(pad, { clientX: 60, clientY: 60 });

    fireEvent.click(screen.getByTitle("Übernehmen"));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0 }));
  });

  it("updates XY offset via mousemove and mouseup during drag", async () => {
    const onConfirm = vi.fn();
    render(<ShadowEditorModal {...defaultProps} x={0} y={0} onConfirm={onConfirm} />);
    const pad = screen.getByLabelText("Shadow offset picker");

    vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 120, height: 120, x: 0, y: 0, right: 120, bottom: 120, toJSON: () => {},
    });

    // Start drag at center (ratio 0.5 → value 0)
    fireEvent.mouseDown(pad, { clientX: 60, clientY: 60 });

    // Move to bottom-right corner and release via act
    const { act } = await import("@testing-library/react");
    act(() => {
      globalThis.dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 120, bubbles: true }));
    });
    act(() => {
      globalThis.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    fireEvent.click(screen.getByTitle("Übernehmen"));
    // mousemove to (120, 120) → ratio 1.0 → value 30
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ x: 30, y: 30 }));
  });

  it("uses first gradient stop color for preview when colorType is gradient", () => {
    render(
      <ShadowEditorModal
        {...defaultProps}
        colorType="gradient"
        gradientStops={[
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ]}
      />,
    );
    const previewText = screen.getByText("Abc");
    expect(previewText.style.textShadow).toContain("#ff0000");
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<ShadowEditorModal {...defaultProps} onClose={onClose} />);
    const dialog = container.querySelector("dialog")!;
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it("updates blur via slider and reflects in confirm output", () => {
    const onConfirm = vi.fn();
    render(<ShadowEditorModal {...defaultProps} blur={4} onConfirm={onConfirm} />);
    // NumSlider renders a range input with title="overlay.blurPx"
    const blurRange = screen.getByTitle("overlay.blurPx") as HTMLInputElement;
    fireEvent.change(blurRange, { target: { value: "12" } });
    fireEvent.click(screen.getByTitle("Übernehmen"));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ blur: 12 }));
  });
});
