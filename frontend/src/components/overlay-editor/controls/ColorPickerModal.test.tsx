import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { ColorPickerModal } from "./ColorPickerModal";

// jsdom does not implement showModal/close on dialog elements
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

describe("ColorPickerModal", () => {
  const defaultProps = {
    color: "#ff0000",
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders the dialog with color picker heading", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(screen.getByText("Farbauswahl")).toBeInTheDocument();
  });

  it("shows hex input field with current color", () => {
    render(<ColorPickerModal {...defaultProps} />);
    const hexInput = screen.getByDisplayValue("FF0000");
    expect(hexInput).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    render(<ColorPickerModal {...defaultProps} onClose={onClose} />);
    const cancelBtn = screen.getByTitle("Abbrechen");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with color when apply button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    const applyBtn = screen.getByTitle("Übernehmen");
    fireEvent.click(applyBtn);
    expect(onConfirm).toHaveBeenCalledWith(expect.stringMatching(/^#/), undefined);
  });

  it("shows preset color swatches", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(screen.getByText("Voreinstellungen")).toBeInTheDocument();
    // 16 preset buttons exist
    expect(screen.getByTitle("#ffffff")).toBeInTheDocument();
    expect(screen.getByTitle("#000000")).toBeInTheDocument();
  });

  it("updates hex input when typing a valid hex color", () => {
    render(<ColorPickerModal {...defaultProps} />);
    const hexInput = screen.getByDisplayValue("FF0000");
    fireEvent.change(hexInput, { target: { value: "00ff00" } });
    expect(screen.getByDisplayValue("00FF00")).toBeInTheDocument();
  });

  it("shows opacity controls when showOpacity is true", () => {
    render(<ColorPickerModal {...defaultProps} showOpacity />);
    expect(screen.getByText("Deckkraft")).toBeInTheDocument();
    expect(screen.getByLabelText("Opacity")).toBeInTheDocument();
  });

  it("hides opacity controls by default", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(screen.queryByText("Deckkraft")).not.toBeInTheDocument();
  });

  it("renders the hue slider", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(screen.getByLabelText("Hue")).toBeInTheDocument();
  });

  it("renders the saturation/brightness picker area", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(
      screen.getByLabelText("Color saturation and brightness picker"),
    ).toBeInTheDocument();
  });
});
