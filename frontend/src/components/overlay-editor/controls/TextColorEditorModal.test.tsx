import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { TextColorEditorModal } from "./TextColorEditorModal";

// jsdom does not implement showModal
HTMLDialogElement.prototype.showModal = vi.fn();

describe("TextColorEditorModal", () => {
  const defaultProps = {
    colorType: "solid" as const,
    color: "#ffffff",
    gradientStops: [],
    gradientAngle: 0,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    onOpenColorPicker: vi.fn(),
    onOpenGradientEditor: vi.fn(),
  };

  it("renders with heading", () => {
    render(<TextColorEditorModal {...defaultProps} />);
    expect(screen.getByText("Textfarbe bearbeiten")).toBeInTheDocument();
  });

  it("renders type toggle buttons", () => {
    render(<TextColorEditorModal {...defaultProps} />);
    expect(screen.getByText("Einfarbig")).toBeInTheDocument();
    expect(screen.getByText("Verlauf")).toBeInTheDocument();
  });

  it("shows solid color swatch when type is solid", () => {
    render(<TextColorEditorModal {...defaultProps} colorType="solid" />);
    expect(screen.getByText("Farbe")).toBeInTheDocument();
  });

  it("shows gradient swatch when type is gradient", () => {
    render(
      <TextColorEditorModal
        {...defaultProps}
        colorType="gradient"
        gradientStops={[
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ]}
      />,
    );
    // The "Verlauf" label appears both as the type toggle and as the section label
    const verlaufElements = screen.getAllByText("Verlauf");
    expect(verlaufElements.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    render(<TextColorEditorModal {...defaultProps} onClose={onClose} />);
    const cancelBtn = screen.getByTitle("Abbrechen");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with current values when apply is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <TextColorEditorModal
        {...defaultProps}
        colorType="solid"
        color="#ff00ff"
        onConfirm={onConfirm}
      />,
    );
    const applyBtn = screen.getByTitle("Übernehmen");
    fireEvent.click(applyBtn);
    expect(onConfirm).toHaveBeenCalledWith("solid", "#ff00ff", [], 0);
  });

  it("calls onClose when close X button is clicked", () => {
    const onClose = vi.fn();
    render(<TextColorEditorModal {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByTitle("Schließen");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders preview text", () => {
    render(<TextColorEditorModal {...defaultProps} />);
    expect(screen.getByText("Abc")).toBeInTheDocument();
  });

  it("switches to gradient type then applies", () => {
    const onConfirm = vi.fn();
    render(<TextColorEditorModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Verlauf"));
    fireEvent.click(screen.getByTitle("Übernehmen"));
    expect(onConfirm).toHaveBeenCalledWith("gradient", expect.any(String), expect.any(Array), expect.any(Number));
    expect(onConfirm.mock.calls[0][0]).toBe("gradient");
  });

  it("applies gradient preview style with >= 2 stops", () => {
    render(
      <TextColorEditorModal
        {...defaultProps}
        colorType="gradient"
        gradientStops={[
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ]}
      />,
    );
    const preview = screen.getByText("Abc");
    // React sets WebkitBackgroundClip; jsdom exposes it via getPropertyValue
    const clipValue = preview.style.getPropertyValue("-webkit-background-clip")
      || (preview.style as unknown as Record<string, string>)["WebkitBackgroundClip"];
    expect(clipValue).toBe("text");
  });

  it("falls back to solid style when gradient has < 2 stops", () => {
    render(
      <TextColorEditorModal
        {...defaultProps}
        colorType="gradient"
        gradientStops={[{ color: "#ff0000", position: 0 }]}
      />,
    );
    const preview = screen.getByText("Abc");
    const clipValue = preview.style.getPropertyValue("-webkit-background-clip")
      || (preview.style as unknown as Record<string, string>)["WebkitBackgroundClip"]
      || "";
    expect(clipValue).not.toBe("text");
  });

  it("calls onOpenColorPicker when solid swatch is clicked", () => {
    const onOpenColorPicker = vi.fn();
    const { container } = render(
      <TextColorEditorModal {...defaultProps} colorType="solid" onOpenColorPicker={onOpenColorPicker} />,
    );
    const swatch = container.querySelector(".w-6.h-4.rounded.cursor-pointer");
    expect(swatch).not.toBeNull();
    fireEvent.click(swatch!);
    expect(onOpenColorPicker).toHaveBeenCalled();
  });

  it("calls onOpenGradientEditor when gradient swatch is clicked", () => {
    const onOpenGradientEditor = vi.fn();
    const { container } = render(
      <TextColorEditorModal
        {...defaultProps}
        colorType="gradient"
        gradientStops={[
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ]}
        onOpenGradientEditor={onOpenGradientEditor}
      />,
    );
    const swatch = container.querySelector(".w-6.h-4.rounded.cursor-pointer");
    expect(swatch).not.toBeNull();
    fireEvent.click(swatch!);
    expect(onOpenGradientEditor).toHaveBeenCalled();
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<TextColorEditorModal {...defaultProps} onClose={onClose} />);
    const dialog = container.querySelector("dialog")!;
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
