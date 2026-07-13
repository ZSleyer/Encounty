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
    const cancelBtn = screen.getByText("Abbrechen");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with color when apply button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    const applyBtn = screen.getByText("Anwenden");
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
    expect(screen.getByLabelText("Deckkraft")).toBeInTheDocument();
  });

  it("hides opacity controls by default", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(screen.queryByText("Deckkraft")).not.toBeInTheDocument();
  });

  it("renders the hue slider", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(screen.getByLabelText("Farbton")).toBeInTheDocument();
  });

  it("renders the saturation/brightness picker area", () => {
    render(<ColorPickerModal {...defaultProps} />);
    expect(
      screen.getByLabelText("Sättigung und Helligkeit wählen"),
    ).toBeInTheDocument();
  });

  // --- Hex input edge cases ---

  it("does not update HSV when hex input has fewer than 6 chars", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    const hexInput = screen.getByDisplayValue("FF0000");
    fireEvent.change(hexInput, { target: { value: "ABC" } });
    expect(screen.getByDisplayValue("ABC")).toBeInTheDocument();
    // Confirm should still return the original red-ish color since HSV was not updated
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^#[fF]{2}0000$/),
      undefined,
    );
  });

  it("strips non-hex characters from hex input", () => {
    render(<ColorPickerModal {...defaultProps} />);
    const hexInput = screen.getByDisplayValue("FF0000");
    fireEvent.change(hexInput, { target: { value: "GG##ZZ" } });
    // After stripping non-hex chars, only "Z" remains (uppercase), resulting in "Z"
    // Actually: G, #, # are stripped; Z, Z remain -> "ZZ" but wait, G is not hex? No, G is not 0-9a-fA-F
    // GG##ZZ -> strip G,G,#,# -> ZZ -> but Z is not hex either! -> empty string
    // Let me re-check: [^0-9a-fA-F] strips everything that is NOT hex
    // G is not hex (a-f only), Z is not hex -> all stripped -> ""
    expect(screen.getByDisplayValue("")).toBeInTheDocument();
  });

  // --- Preset click ---

  it("updates hex input when clicking a preset swatch", () => {
    render(<ColorPickerModal {...defaultProps} />);
    fireEvent.click(screen.getByTitle("#00ff00"));
    expect(screen.getByDisplayValue("00FF00")).toBeInTheDocument();
  });

  // --- hsvToRgb all 6 hue branches ---

  it("hsvToRgb: h 60-120 range (yellow-green)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    const hexInput = screen.getByDisplayValue("FF0000");
    fireEvent.change(hexInput, { target: { value: "80FF00" } });
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^#/),
      undefined,
    );
  });

  it("hsvToRgb: h 120-180 range (green-cyan)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByDisplayValue("FF0000"), {
      target: { value: "00FF80" },
    });
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^#/),
      undefined,
    );
  });

  it("hsvToRgb: h 180-240 range (cyan-blue)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByDisplayValue("FF0000"), {
      target: { value: "0080FF" },
    });
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^#/),
      undefined,
    );
  });

  it("hsvToRgb: h 240-300 range (blue-magenta)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByDisplayValue("FF0000"), {
      target: { value: "8000FF" },
    });
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^#/),
      undefined,
    );
  });

  it("hsvToRgb: h 300-360 range (magenta-red)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByDisplayValue("FF0000"), {
      target: { value: "FF0080" },
    });
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^#/),
      undefined,
    );
  });

  // --- rgbToHsv branches ---

  it("rgbToHsv: max === rn (pure red)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal color="#ff0000" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith("#ff0000", undefined);
  });

  it("rgbToHsv: max === gn (pure green)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal color="#00ff00" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith("#00ff00", undefined);
  });

  it("rgbToHsv: max === bn (pure blue)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal color="#0000ff" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith("#0000ff", undefined);
  });

  it("rgbToHsv: h < 0 wrap (cyan where blue === green)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal color="#00ffff" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(expect.stringMatching(/^#00[fF]{2}[fF]{2}$/), undefined);
  });

  it("rgbToHsv: s === 0 when max === 0 (black)", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal color="#000000" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith("#000000", undefined);
  });

  // --- Confirm with opacity ---

  it("calls onConfirm with opacity when showOpacity is true", () => {
    const onConfirm = vi.fn();
    render(
      <ColorPickerModal
        color="#ff0000"
        showOpacity
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Anwenden"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^#/),
      expect.any(Number),
    );
  });

  // --- Drag handlers ---

  it("handles mouseDown on saturation area without crashing", () => {
    render(<ColorPickerModal {...defaultProps} />);
    const satArea = screen.getByLabelText("Sättigung und Helligkeit wählen");
    fireEvent.mouseDown(satArea, { clientX: 50, clientY: 50 });
    // Should not throw; jsdom returns zeros for getBoundingClientRect
    expect(satArea).toBeInTheDocument();
  });

  it("handles mouseDown on hue slider without crashing", () => {
    render(<ColorPickerModal {...defaultProps} />);
    const hueSlider = screen.getByLabelText("Farbton");
    fireEvent.mouseDown(hueSlider, { clientX: 100, clientY: 0 });
    expect(hueSlider).toBeInTheDocument();
  });

  it("handles mouseDown on opacity slider without crashing", () => {
    render(<ColorPickerModal {...defaultProps} showOpacity />);
    const opacitySlider = screen.getByLabelText("Deckkraft");
    fireEvent.mouseDown(opacitySlider, { clientX: 50, clientY: 0 });
    expect(opacitySlider).toBeInTheDocument();
  });

  // --- Keyboard-driven adjustments ---

  it("adjusts saturation and brightness via arrow keys and updates hex", () => {
    render(<ColorPickerModal color="#ff0000" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const satArea = screen.getByLabelText("Sättigung und Helligkeit wählen");
    const before = screen.getByDisplayValue("FF0000");
    expect(before).toBeInTheDocument();
    fireEvent.keyDown(satArea, { key: "ArrowLeft" });
    // Saturation decreased -> hex should no longer be pure red (FF0000)
    expect(screen.queryByDisplayValue("FF0000")).not.toBeInTheDocument();
    expect(satArea).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("Saturation"),
    );
  });

  it("adjusts brightness via ArrowUp/ArrowDown on the saturation area", () => {
    render(<ColorPickerModal color="#ff0000" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const satArea = screen.getByLabelText("Sättigung und Helligkeit wählen");
    fireEvent.keyDown(satArea, { key: "ArrowDown" });
    expect(screen.queryByDisplayValue("FF0000")).not.toBeInTheDocument();
  });

  it("ignores non-arrow keys on the saturation area", () => {
    render(<ColorPickerModal {...defaultProps} />);
    const satArea = screen.getByLabelText("Sättigung und Helligkeit wählen");
    fireEvent.keyDown(satArea, { key: "Enter" });
    expect(screen.getByDisplayValue("FF0000")).toBeInTheDocument();
  });

  it("adjusts hue via arrow keys and updates hex", () => {
    render(<ColorPickerModal color="#ff0000" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const hueSlider = screen.getByLabelText("Farbton");
    fireEvent.keyDown(hueSlider, { key: "ArrowRight" });
    expect(screen.queryByDisplayValue("FF0000")).not.toBeInTheDocument();
  });

  it("adjusts hue down via ArrowLeft/ArrowDown, clamped at 0", () => {
    render(<ColorPickerModal color="#ff0000" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const hueSlider = screen.getByLabelText("Farbton");
    fireEvent.keyDown(hueSlider, { key: "ArrowDown" });
    // Hue was already 0, clamped -> stays FF0000
    expect(screen.getByDisplayValue("FF0000")).toBeInTheDocument();
  });

  it("adjusts opacity via arrow keys", () => {
    render(
      <ColorPickerModal color="#ff0000" opacity={0} showOpacity onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const opacitySlider = screen.getByLabelText("Deckkraft");
    expect(screen.getByText("0%")).toBeInTheDocument();
    fireEvent.keyDown(opacitySlider, { key: "ArrowRight" });
    expect(screen.getByText("5%")).toBeInTheDocument();
    fireEvent.keyDown(opacitySlider, { key: "ArrowUp" });
    expect(screen.getByText("10%")).toBeInTheDocument();
    fireEvent.keyDown(opacitySlider, { key: "ArrowLeft" });
    expect(screen.getByText("5%")).toBeInTheDocument();
    fireEvent.keyDown(opacitySlider, { key: "ArrowDown" });
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("ignores non-arrow keys on the opacity slider", () => {
    render(
      <ColorPickerModal color="#ff0000" opacity={0} showOpacity onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const opacitySlider = screen.getByLabelText("Deckkraft");
    fireEvent.keyDown(opacitySlider, { key: "Tab" });
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  // --- Backdrop click ---

  it("calls onClose when pressing outside the dialog", () => {
    const onClose = vi.fn();
    render(<ColorPickerModal {...defaultProps} onClose={onClose} />);
    // The modal listens for mousedown on the document and closes when the
    // press originates outside the dialog's bounding rect. In jsdom the rect
    // defaults to {0,0,0,0}, so any positive coordinate is "outside".
    document.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
