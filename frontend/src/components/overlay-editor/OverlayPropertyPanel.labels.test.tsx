/**
 * Optional label of a value layer in the property panel: the toggle, the label
 * text and the label's own text style.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, makeOverlaySettings, userEvent } from "../../test-utils";
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
  it("shows label text input when show_label is true", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
        label_text: "Encounters:",
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Encounters:");
  });

  // --- Counter show_label toggle ---

  it("calls onUpdate when show_label checkbox is toggled off", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    // Find the show_label checkbox by its label text
    const labelCheckbox = screen.getByRole("checkbox", { name: /Label anzeigen/ });
    fireEvent.click(labelCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ show_label: false }),
      }),
    );
  });

  it("hides label text input when show_label is false", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: false,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.queryByPlaceholderText("Label-Text")).not.toBeInTheDocument();
  });

  it("shows label style editor when show_label is true", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Label-Stil")).toBeInTheDocument();
  });

  // --- Counter label text input ---

  it("calls onUpdate when label text is changed", async () => {
    const user = userEvent.setup();
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: true,
        label_text: "",
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    const input = screen.getByPlaceholderText("Label-Text");
    await user.type(input, "E");
    expect(props.onUpdate).toHaveBeenCalled();
  });

  // --- Show_label toggle ON ---

  it("calls onUpdate when show_label checkbox is toggled on", () => {
    const settings = makeOverlaySettings({
      counter: {
        ...makeOverlaySettings().counter,
        show_label: false,
      },
    });
    const props = makeProps({ selectedEl: "counter", settings });
    render(<OverlayPropertyPanel {...props} />);
    const labelCheckbox = screen.getByRole("checkbox", { name: /Label anzeigen/ });
    fireEvent.click(labelCheckbox);
    expect(props.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        counter: expect.objectContaining({ show_label: true }),
      }),
    );
  });

  // --- Text style editor for counter ---

  it("shows counter style editor when counter is selected", () => {
    const props = makeProps({ selectedEl: "counter" });
    render(<OverlayPropertyPanel {...props} />);
    expect(screen.getByText("Zähler-Stil")).toBeInTheDocument();
  });
});
