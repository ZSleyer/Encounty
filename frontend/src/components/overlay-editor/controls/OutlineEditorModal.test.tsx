import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { OutlineEditorModal } from "./OutlineEditorModal";

// jsdom does not implement showModal
HTMLDialogElement.prototype.showModal = vi.fn();

describe("OutlineEditorModal", () => {
  const defaultProps = {
    type: "none" as const,
    color: "#000000",
    width: 2,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    onOpenColorPicker: vi.fn(),
  };

  it("renders with heading", () => {
    render(<OutlineEditorModal {...defaultProps} />);
    expect(screen.getByText("Outline bearbeiten")).toBeInTheDocument();
  });

  it("renders type toggle buttons", () => {
    render(<OutlineEditorModal {...defaultProps} />);
    // t("overlay.animNone") = "Keine", t("overlay.colorSolid") = "overlay.colorSolid" (missing key)
    expect(screen.getByText("Keine")).toBeInTheDocument();
    expect(screen.getByText("overlay.colorSolid")).toBeInTheDocument();
  });

  it("shows width slider when type is solid", () => {
    render(<OutlineEditorModal {...defaultProps} type="solid" />);
    // The NumSlider renders a range input
    expect(screen.getByTitle("overlay.widthPx")).toBeInTheDocument();
  });

  it("hides width slider when type is none", () => {
    render(<OutlineEditorModal {...defaultProps} type="none" />);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    render(<OutlineEditorModal {...defaultProps} onClose={onClose} />);
    const cancelBtn = screen.getByTitle("Abbrechen");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with current values when apply is clicked", () => {
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
    const applyBtn = screen.getByTitle("Übernehmen");
    fireEvent.click(applyBtn);
    expect(onConfirm).toHaveBeenCalledWith("solid", "#ff0000", 5);
  });

  it("calls onClose when close X button is clicked", () => {
    const onClose = vi.fn();
    render(<OutlineEditorModal {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByTitle("Schließen");
    fireEvent.click(closeBtn);
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

  it("applies stroke style to preview when type is solid", () => {
    render(<OutlineEditorModal {...defaultProps} type="solid" color="#ff0000" width={3} />);
    const preview = screen.getByText("Abc");
    expect(preview.style.webkitTextStroke).toBeTruthy();
  });

  it("does not apply stroke style when type is none", () => {
    render(<OutlineEditorModal {...defaultProps} type="none" />);
    const preview = screen.getByText("Abc");
    expect(preview.style.webkitTextStroke).toBeFalsy();
  });
});
