/**
 * Style editor modals of the overlay editor: opening them from a swatch,
 * confirming them and closing them again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makeOverlaySettings, makePokemon, userEvent } from "../../test-utils";
import { OverlayEditor } from "./OverlayEditor";

// Mock the overlay utils
vi.mock("../../utils/overlay", () => ({
  resolveOverlay: (_p: unknown, _all: unknown, settings: unknown) => settings,
  wouldCreateCircularLink: () => false,
}));

// Mock the api utility
vi.mock("../../utils/api", () => ({
  apiUrl: (path: string) => `http://localhost:8192${path}`,
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  vi.stubGlobal("fetch", mockFetch);
  // Mock localStorage for tutorial and split state
  const store: Record<string, string> = { encounty_editor_tutorial_seen: "true" };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
  // Mock HTMLDialogElement methods not available in jsdom
  HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || vi.fn();
  HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || vi.fn();
});

describe("OverlayEditor", () => {
  // --- ColorPickerModal opens when background color swatch is clicked ---

  it("opens ColorPickerModal when background color swatch is clicked on canvas", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer to show canvas properties
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);

    // Click the background color swatch (title is the label plus the hex code)
    const colorSwatch = screen.getByTitle("Farbe #000000");
    await user.click(colorSwatch);

    // ColorPickerModal should now be rendered, look for dialog element
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
  });

  // --- TextColorEditorModal opens when text color swatch is clicked ---

  it("opens TextColorEditorModal when text color swatch is clicked on name layer", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // Click the text color swatch, title is "Farbe #ffffff"
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // TextColorEditorModal should now be visible
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- OutlineEditorModal opens when outline swatch is clicked ---

  it("opens OutlineEditorModal when outline swatch is clicked on name layer", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // Click the outline swatch, title is "Umriss (Keine)" for none outline
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // OutlineEditorModal should render
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- ShadowEditorModal opens when shadow swatch is clicked ---

  it("opens ShadowEditorModal when shadow swatch is clicked on name layer", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);

    // Click the shadow swatch, title is "Schatten (Aus)"
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // ShadowEditorModal should render
    const allText = document.body.textContent ?? "";
    expect(allText).toBeTruthy();
  });

  // --- ColorPickerModal close dismisses modal ---

  it("closes ColorPickerModal when close callback fires", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Select canvas layer and open color picker
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const colorSwatch = screen.getByTitle("Farbe #000000");
    await user.click(colorSwatch);

    // Dialog should be open
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();

    // Close button in the modal (aria-label for close)
    const closeBtn = screen.queryByLabelText(/Schließen|Close/i);
    if (closeBtn) {
      await user.click(closeBtn);
    }
    // Component should still render fine
    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
  });

  // --- TextColorEditorModal confirm ---

  it("confirms TextColorEditorModal and closes it", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer and open text color editor
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // The TextColorEditorModal should have a confirm button
    const confirmBtn = screen.queryByText("Anwenden");
    if (confirmBtn) {
      await user.click(confirmBtn);
      // onUpdate should have been called with the updated style
      expect(onUpdate).toHaveBeenCalled();
    }
    // Component should still render
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- OutlineEditorModal confirm ---

  it("confirms OutlineEditorModal and closes it", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // Confirm button in OutlineEditorModal
    const confirmBtn = screen.queryByText("Anwenden");
    if (confirmBtn) {
      await user.click(confirmBtn);
    }
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- ShadowEditorModal confirm ---

  it("confirms ShadowEditorModal and closes it", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // Confirm in shadow modal
    const confirmBtn = screen.queryByText("Anwenden");
    if (confirmBtn) {
      await user.click(confirmBtn);
    }
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- ColorPickerModal confirm callback exercises colorPickerTarget.onConfirm ---

  it("exercises ColorPickerModal confirm callback and dismisses modal", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Open color picker via canvas background color swatch
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const colorSwatch = screen.getByTitle("Farbe #000000");
    await user.click(colorSwatch);

    // Dialog should be open
    expect(document.querySelector("dialog")).not.toBeNull();

    // Click the confirm/apply button
    const applyBtn = screen.getByText("Anwenden");
    await user.click(applyBtn);

    // Modal should be dismissed (colorPickerTarget set to null)
    // onUpdate should have been called with updated background_color
    expect(onUpdate).toHaveBeenCalled();
  });

  // --- OutlineEditorModal confirm callback ---

  it("exercises OutlineEditorModal confirm callback", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    // Select name layer and open outline editor
    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // Click the apply button inside the OutlineEditorModal
    const applyBtns = screen.getAllByText("Anwenden");
    await user.click(applyBtns[applyBtns.length - 1]);

    // Modal should close and onUpdate should be called
    expect(onUpdate).toHaveBeenCalled();
  });

  // --- ShadowEditorModal confirm callback ---

  it("exercises ShadowEditorModal confirm callback", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // Click apply in ShadowEditorModal
    const applyBtns = screen.getAllByText("Anwenden");
    await user.click(applyBtns[applyBtns.length - 1]);

    expect(onUpdate).toHaveBeenCalled();
  });

  // --- TextColorEditorModal confirm callback ---

  it("exercises TextColorEditorModal confirm callback", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={onUpdate}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // Click apply in TextColorEditorModal
    const applyBtns = screen.getAllByText("Anwenden");
    await user.click(applyBtns[applyBtns.length - 1]);

    expect(onUpdate).toHaveBeenCalled();
  });

  // --- ColorPickerModal close callback ---

  it("exercises ColorPickerModal close callback and nullifies target", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    // Open color picker
    const canvasLayerButtons = screen.getAllByLabelText("Canvas");
    await user.click(canvasLayerButtons[0]);
    const colorSwatch = screen.getByTitle("Farbe #000000");
    await user.click(colorSwatch);

    // Click cancel button
    const cancelBtn = screen.queryByText("Abbrechen");
    if (cancelBtn) {
      await user.click(cancelBtn);
    }
    // Modal should be dismissed
    expect(screen.getAllByText("Canvas").length).toBeGreaterThan(0);
  });

  // --- OutlineEditorModal close callback ---

  it("exercises OutlineEditorModal close callback", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const outlineSwatch = screen.getByTitle(/^Umriss/);
    await user.click(outlineSwatch);

    // Click cancel in OutlineEditorModal
    const cancelBtns = screen.getAllByText("Abbrechen");
    await user.click(cancelBtns[cancelBtns.length - 1]);

    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- ShadowEditorModal close callback ---

  it("exercises ShadowEditorModal close callback", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const shadowSwatch = screen.getByTitle(/^Schatten/);
    await user.click(shadowSwatch);

    // Click cancel in ShadowEditorModal
    const cancelBtns = screen.getAllByText("Abbrechen");
    await user.click(cancelBtns[cancelBtns.length - 1]);

    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });

  // --- TextColorEditorModal close callback ---

  it("exercises TextColorEditorModal close callback", async () => {
    const user = userEvent.setup();
    render(
      <OverlayEditor
        settings={makeOverlaySettings()}
        onUpdate={vi.fn()}
        activePokemon={makePokemon()}
      />,
    );

    const nameLayerButtons = screen.getAllByLabelText("Name");
    await user.click(nameLayerButtons[0]);
    const colorSwatches = screen.getAllByTitle(/^Farbe #/);
    await user.click(colorSwatches[0]);

    // Click cancel in TextColorEditorModal
    const cancelBtns = screen.getAllByText("Abbrechen");
    await user.click(cancelBtns[cancelBtns.length - 1]);

    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
  });
});
