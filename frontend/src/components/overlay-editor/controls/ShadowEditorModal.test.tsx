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
});
