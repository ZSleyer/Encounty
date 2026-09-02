/**
 * Odds and timer branches of the property panel: the odds format select and
 * the rows both value layers share.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makeOverlaySettings } from "../../test-utils";
import { OverlayPropertyPanel } from "./OverlayPropertyPanel";
import type { OverlaySettings, OverlayElementBase } from "../../types";

type ElementKey = "sprite" | "name" | "title" | "counter" | "timer" | "odds" | "canvas";

/** Build default props with sensible mock callbacks. */
function makeProps(overrides?: {
  selectedEl?: ElementKey;
  settings?: OverlaySettings;
  readOnly?: boolean;
  embedded?: boolean;
  bgPreviewUrl?: string;
  bgUploading?: boolean;
  onBgUpload?: () => void;
  onBgRemove?: () => void;
}) {
  const settings = overrides?.settings ?? makeOverlaySettings();
  return {
    localSettings: settings,
    selectedEl: overrides?.selectedEl ?? ("sprite" as const),
    updateSelectedEl: vi.fn() as (patch: Partial<OverlayElementBase>) => void,
    onUpdate: vi.fn() as (s: OverlaySettings) => void,
    openColorPicker: vi.fn(),
    openOutlineEditor: vi.fn(),
    openShadowEditor: vi.fn(),
    openTextColorEditor: vi.fn(),
    fireTest: vi.fn(),
    readOnly: overrides?.readOnly,
    embedded: overrides?.embedded,
    bgPreviewUrl: overrides?.bgPreviewUrl,
    bgUploading: overrides?.bgUploading,
    onBgUpload: overrides?.onBgUpload,
    onBgRemove: overrides?.onBgRemove,
  };
}

describe("OverlayPropertyPanel", () => {
  // --- Odds element branch ---

  it("renders the odds-specific style editor and format toggle", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Odds-Stil")).toBeInTheDocument();
    const formatSelect = screen.getByLabelText("Odds-Anzeigeformat") as HTMLSelectElement;
    expect(formatSelect).toBeInTheDocument();
    expect(formatSelect.value).toBe("fractional");
  });

  it("updates odds.format when the format select changes", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const formatSelect = screen.getByLabelText("Odds-Anzeigeformat");
    fireEvent.change(formatSelect, { target: { value: "percent" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({ format: "percent" }),
      }),
    );
  });

  it("toggles odds show_label", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const showLabelCheckbox = screen.getByLabelText(/Label anzeigen/);
    fireEvent.click(showLabelCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({ show_label: true }),
      }),
    );
  });

  it("shows odds label text input when show_label is true", () => {
    const settings = makeOverlaySettings({
      odds: { ...makeOverlaySettings().odds, show_label: true, label_text: "Chance:" },
    });
    const props = makeProps({ selectedEl: "odds", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text") as HTMLInputElement;
    expect(input.value).toBe("Chance:");
  });

  it("fires the odds test callback (enter)", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("odds");
  });

  it("fires the odds decrement test callback", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("odds", true);
  });

  it("updates odds trigger_enter when the trigger select changes", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const triggerSelect = document.getElementById("odds-trigger-animation") as HTMLSelectElement;
    fireEvent.change(triggerSelect, { target: { value: "pop" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({ trigger_enter: "pop" }),
      }),
    );
  });

  it("updates odds trigger_decrement when the decrement select changes", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const decSelect = document.getElementById(
      "odds-trigger-decrement-animation",
    ) as HTMLSelectElement;
    fireEvent.change(decSelect, { target: { value: "shake" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({ trigger_decrement: "shake" }),
      }),
    );
  });

  it("updates odds idle_animation", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const idleSelect = document.getElementById("odds-idle-animation") as HTMLSelectElement;
    fireEvent.change(idleSelect, { target: { value: "shimmer" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({ idle_animation: "shimmer" }),
      }),
    );
  });

  it("updates odds label_text", () => {
    const settings = makeOverlaySettings({
      odds: { ...makeOverlaySettings().odds, show_label: true, label_text: "Odds:" },
    });
    const props = makeProps({ selectedEl: "odds", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text");
    fireEvent.change(input, { target: { value: "Chance:" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({ label_text: "Chance:" }),
      }),
    );
  });

  // --- Timer element branch ---

  it("renders timer-specific style editor when timer is selected", () => {
    const props = makeProps({ selectedEl: "timer" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Timer-Stil")).toBeInTheDocument();
  });

  it("toggles timer show_label", () => {
    const props = makeProps({ selectedEl: "timer" });
    render(<OverlayPropertyPanel {...props} />);
    const showLabelCheckbox = screen.getByLabelText(/Label anzeigen/);
    fireEvent.click(showLabelCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        timer: expect.objectContaining({ show_label: true }),
      }),
    );
  });

  it("updates timer idle_animation", () => {
    const props = makeProps({ selectedEl: "timer" });
    render(<OverlayPropertyPanel {...props} />);
    const idleSelect = document.getElementById("timer-idle-animation") as HTMLSelectElement;
    fireEvent.change(idleSelect, { target: { value: "glow" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        timer: expect.objectContaining({ idle_animation: "glow" }),
      }),
    );
  });

  it("shows timer label text input when show_label is true", () => {
    const settings = makeOverlaySettings({
      timer: { ...makeOverlaySettings().timer, show_label: true, label_text: "Timer:" },
    });
    const props = makeProps({ selectedEl: "timer", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text") as HTMLInputElement;
    expect(input.value).toBe("Timer:");
  });

  it("updates timer label_text", () => {
    const settings = makeOverlaySettings({
      timer: { ...makeOverlaySettings().timer, show_label: true, label_text: "Timer:" },
    });
    const props = makeProps({ selectedEl: "timer", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text");
    fireEvent.change(input, { target: { value: "Elapsed:" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        timer: expect.objectContaining({ label_text: "Elapsed:" }),
      }),
    );
  });

  it("updates the timer label text style when the label editor fires", () => {
    const settings = makeOverlaySettings({
      timer: { ...makeOverlaySettings().timer, show_label: true, label_text: "Timer:" },
    });
    const props = makeProps({ selectedEl: "timer", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Two font selects appear when show_label is on: main + label.
    const fontSelects = screen.getAllByText("Schriftart");
    const labelFontSelect = fontSelects[1].closest("label")!.querySelector("select")!;
    fireEvent.change(labelFontSelect, { target: { value: "pokemon" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        timer: expect.objectContaining({
          label_style: expect.objectContaining({ font_family: "pokemon" }),
        }),
      }),
    );
  });

  it("updates the odds main text style when the main editor fires", () => {
    const props = makeProps({ selectedEl: "odds" });
    render(<OverlayPropertyPanel {...props} />);
    const fontSelect = screen
      .getAllByText("Schriftart")[0]
      .closest("label")!
      .querySelector("select")!;
    fireEvent.change(fontSelect, { target: { value: "pokemon" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({
          style: expect.objectContaining({ font_family: "pokemon" }),
        }),
      }),
    );
  });

  it("updates the odds label text style when the label editor fires", () => {
    const settings = makeOverlaySettings({
      odds: { ...makeOverlaySettings().odds, show_label: true, label_text: "Odds:" },
    });
    const props = makeProps({ selectedEl: "odds", settings });
    render(<OverlayPropertyPanel {...props} />);
    const fontSelects = screen.getAllByText("Schriftart");
    const labelFontSelect = fontSelects[1].closest("label")!.querySelector("select")!;
    fireEvent.change(labelFontSelect, { target: { value: "pokemon" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        odds: expect.objectContaining({
          label_style: expect.objectContaining({ font_family: "pokemon" }),
        }),
      }),
    );
  });
});
