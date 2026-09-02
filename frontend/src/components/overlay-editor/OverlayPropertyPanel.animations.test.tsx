/**
 * Animation rows of the property panel for the text layers: the selects and
 * the test buttons that fire one run.
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
  it("fires the test callback when Test button is clicked for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("counter");
  });

  // --- Name element animations ---

  it("calls onUpdate when idle animation is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Dauerhaft");
    fireEvent.change(select, { target: { value: "breathe" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ idle_animation: "breathe" }),
      }),
    );
  });

  it("calls onUpdate when trigger animation is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Bei Encounter");
    fireEvent.change(select, { target: { value: "pop" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ trigger_enter: "pop" }),
      }),
    );
  });

  it("fires test callback for name element", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("name");
  });

  it("fires decrement test callback for name element", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("name", true);
  });

  // --- Title element animations ---

  it("calls onUpdate when idle animation is changed for title", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Dauerhaft");
    fireEvent.change(select, { target: { value: "glow" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ idle_animation: "glow" }),
      }),
    );
  });

  it("fires test callback for title element", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[0]);
    expect(props.fireTest).toHaveBeenCalledWith("title");
  });

  it("fires decrement test callback for title element", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("title", true);
  });

  // --- Counter element animations ---

  it("calls onUpdate when idle animation is changed for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Dauerhaft");
    fireEvent.change(select, { target: { value: "shimmer" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ idle_animation: "shimmer" }),
      }),
    );
  });

  it("calls onUpdate when trigger animation is changed for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Bei Encounter");
    fireEvent.change(select, { target: { value: "slot" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ trigger_enter: "slot" }),
      }),
    );
  });

  it("fires decrement test callback for counter element", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const testButtons = screen.getAllByText("Test");
    fireEvent.click(testButtons[1]);
    expect(props.fireTest).toHaveBeenCalledWith("counter", true);
  });

  // --- Counter decrement animation change ---

  it("calls onUpdate when decrement animation is changed for counter", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Beim Zurückzählen");
    fireEvent.change(select, { target: { value: "flash" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ trigger_decrement: "flash" }),
      }),
    );
  });

  // --- Name decrement animation change ---

  it("calls onUpdate when decrement animation is changed for name", () => {
    const props = makeProps({ selectedEl: "name" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Beim Zurückzählen");
    fireEvent.change(select, { target: { value: "bounce" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.objectContaining({ trigger_decrement: "bounce" }),
      }),
    );
  });

  // --- Title decrement animation change ---

  it("calls onUpdate when decrement animation is changed for title", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Beim Zurückzählen");
    fireEvent.change(select, { target: { value: "tada" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ trigger_decrement: "tada" }),
      }),
    );
  });

  // --- Title trigger animation change ---

  it("calls onUpdate when trigger animation is changed for title", () => {
    const props = makeProps({ selectedEl: "title" });
    render(<OverlayPropertyPanel {...props} />);
    const select = screen.getByLabelText("Bei Encounter");
    fireEvent.change(select, { target: { value: "slide-in" } });
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ trigger_enter: "slide-in" }),
      }),
    );
  });
});
