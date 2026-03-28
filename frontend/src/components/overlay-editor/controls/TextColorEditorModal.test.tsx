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
});
