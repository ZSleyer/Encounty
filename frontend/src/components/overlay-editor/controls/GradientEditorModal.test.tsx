import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
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
});
