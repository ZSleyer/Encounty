import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { OutlineEditorModal } from "./OutlineEditorModal";

// jsdom does not implement showModal
HTMLDialogElement.prototype.showModal = vi.fn();

const STOPS = [
  { color: "#ff0000", position: 0 },
  { color: "#0000ff", position: 100 },
];

describe("OutlineEditorModal", () => {
  const defaultProps = {
    type: "none" as const,
    color: "#000000",
    width: 2,
    gradientStops: STOPS,
    gradientAngle: 90,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    onOpenColorPicker: vi.fn(),
    onOpenGradientEditor: vi.fn(),
  };

  /** The stroke layer is the first "Abc" span; without an outline there is only one. */
  const strokeLayer = () => screen.getAllByText("Abc")[0];

  it("renders with heading", () => {
    render(<OutlineEditorModal {...defaultProps} />);
    expect(screen.getByText("Outline bearbeiten")).toBeInTheDocument();
  });

  it("renders a toggle button for each of the three modes", () => {
    render(<OutlineEditorModal {...defaultProps} />);
    expect(screen.getByText("Keine")).toBeInTheDocument();
    expect(screen.getByText("Einfarbig")).toBeInTheDocument();
    expect(screen.getByText("Verlauf")).toBeInTheDocument();
  });

  it("marks the active mode with aria-pressed", () => {
    render(<OutlineEditorModal {...defaultProps} type="gradient" />);
    expect(screen.getAllByText("Verlauf")[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Keine")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows width slider when type is solid", () => {
    render(<OutlineEditorModal {...defaultProps} type="solid" />);
    expect(screen.getByTitle("Breite")).toBeInTheDocument();
  });

  it("shows width slider when type is gradient", () => {
    render(<OutlineEditorModal {...defaultProps} type="gradient" />);
    expect(screen.getByTitle("Breite")).toBeInTheDocument();
  });

  it("hides width slider when type is none", () => {
    render(<OutlineEditorModal {...defaultProps} type="none" />);
    expect(screen.queryByTitle("Breite")).not.toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    render(<OutlineEditorModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Abbrechen"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // --- The three modes the renderer understands ---

  it("confirms a none outline", () => {
    const onConfirm = vi.fn();
    render(<OutlineEditorModal {...defaultProps} type="none" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith("none", "#000000", 2, STOPS, 90);
  });

  it("confirms a solid outline with its colour and width", () => {
    const onConfirm = vi.fn();
    render(
      <OutlineEditorModal
        {...defaultProps}
        type="solid"
        color="#ff0000"
        width={5}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith("solid", "#ff0000", 5, STOPS, 90);
  });

  it("confirms a gradient outline with its stops and angle", () => {
    const onConfirm = vi.fn();
    render(
      <OutlineEditorModal
        {...defaultProps}
        type="gradient"
        width={4}
        gradientAngle={45}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith("gradient", "#000000", 4, STOPS, 45);
  });

  it("switches from none to gradient and confirms the new mode", () => {
    const onConfirm = vi.fn();
    render(<OutlineEditorModal {...defaultProps} type="none" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Verlauf"));
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm.mock.calls[0][0]).toBe("gradient");
  });

  it("opens the shared gradient editor from the gradient swatch", () => {
    const onOpenGradientEditor = vi.fn();
    render(
      <OutlineEditorModal
        {...defaultProps}
        type="gradient"
        onOpenGradientEditor={onOpenGradientEditor}
      />,
    );
    fireEvent.click(screen.getByTitle("Farbe bearbeiten"));
    expect(onOpenGradientEditor).toHaveBeenCalledWith(STOPS, 90, expect.any(Function));
  });

  it("calls onClose when close X button is clicked", () => {
    const onClose = vi.fn();
    render(<OutlineEditorModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Schließen"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders preview text", () => {
    render(<OutlineEditorModal {...defaultProps} />);
    expect(screen.getByText("Abc")).toBeInTheDocument();
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<OutlineEditorModal {...defaultProps} onClose={onClose} />);
    const dialog = container.querySelector("dialog")!;
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  // --- Preview matches what the renderer paints ---

  it("strokes the preview in the outline colour when type is solid", () => {
    render(<OutlineEditorModal {...defaultProps} type="solid" color="#ff0000" width={3} />);
    expect(strokeLayer().style.webkitTextStroke).toContain("#ff0000");
    expect(strokeLayer().style.webkitTextStroke).toContain("6px");
  });

  it("strokes transparent and clips a gradient when type is gradient", () => {
    render(<OutlineEditorModal {...defaultProps} type="gradient" width={3} gradientAngle={45} />);
    const stroke = strokeLayer();
    expect(stroke.style.webkitTextStroke).toContain("transparent");
    expect(stroke.style.background).toContain("linear-gradient(45deg");
    expect(stroke.style.webkitBackgroundClip).toBe("text");
  });

  it("does not apply stroke style when type is none", () => {
    render(<OutlineEditorModal {...defaultProps} type="none" />);
    expect(strokeLayer().style.webkitTextStroke).toBeFalsy();
  });

  it("reserves room for the stroke so a thick outline is not clipped", () => {
    const { container } = render(
      <OutlineEditorModal {...defaultProps} type="solid" width={10} />,
    );
    const preview = container.querySelector(".canvas-checkered") as HTMLElement;
    // Half the doubled stroke width sits outside the glyph box.
    expect(preview.style.paddingTop).toBe("10px");
    expect(preview.style.paddingBottom).toBe("10px");
  });
});
