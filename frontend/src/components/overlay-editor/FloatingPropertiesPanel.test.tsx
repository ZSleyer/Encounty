import { describe, it, expect, vi } from "vitest";
import { render, screen, makeOverlaySettings } from "../../test-utils";
import { FloatingPropertiesPanel } from "./FloatingPropertiesPanel";

function makeProps(overrides?: Record<string, unknown>) {
  return {
    onClose: vi.fn(),
    position: { x: 100, y: 200 },
    onDragStart: vi.fn(),
    localSettings: makeOverlaySettings(),
    selectedEl: "sprite" as const,
    updateSelectedEl: vi.fn(),
    onUpdate: vi.fn(),
    openColorPicker: vi.fn(),
    openOutlineEditor: vi.fn(),
    openShadowEditor: vi.fn(),
    openTextColorEditor: vi.fn(),
    fireTest: vi.fn(),
    bgPreviewUrl: "",
    bgUploading: false,
    onBgUpload: vi.fn(),
    onBgRemove: vi.fn(),
    ...overrides,
  };
}

describe("FloatingPropertiesPanel", () => {
  it("renders panel with properties aria-label", () => {
    render(<FloatingPropertiesPanel {...makeProps()} />);
    expect(screen.getByLabelText("Eigenschaften")).toBeInTheDocument();
  });

  it("renders element label for selected element", () => {
    render(<FloatingPropertiesPanel {...makeProps({ selectedEl: "name" })} />);
    // The title bar shows the element name (may appear in property panel too)
    const nameElements = screen.getAllByText("Name");
    expect(nameElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders close button with aria-label", () => {
    render(<FloatingPropertiesPanel {...makeProps()} />);
    expect(screen.getByLabelText("Schließen")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<FloatingPropertiesPanel {...makeProps({ onClose })} />);
    const closeBtn = screen.getByLabelText("Schließen");
    closeBtn.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders at specified position", () => {
    const { container } = render(
      <FloatingPropertiesPanel {...makeProps({ position: { x: 300, y: 400 } })} />,
    );
    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.style.left).toBe("300px");
    expect(dialog?.style.top).toBe("400px");
  });

  it("shows canvas label when canvas is selected", () => {
    render(<FloatingPropertiesPanel {...makeProps({ selectedEl: "canvas" })} />);
    const canvasElements = screen.getAllByText("Canvas");
    expect(canvasElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders OBS source hint when provided", () => {
    render(
      <FloatingPropertiesPanel
        {...makeProps({ obsSourceHint: <span>OBS Hint</span> })}
      />,
    );
    expect(screen.getByText("OBS Hint")).toBeInTheDocument();
  });
});
