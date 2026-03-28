import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { EditorTutorial } from "./EditorTutorial";

/** Create stub tutorial target elements so the component can find its anchors. */
function setupTargets() {
  for (const name of ["canvas", "layers", "properties", "toolbar"]) {
    const el = document.createElement("div");
    el.dataset.tutorial = name;
    el.style.width = "100px";
    el.style.height = "100px";
    el.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100, x: 10, y: 10, toJSON: vi.fn() });
    document.body.appendChild(el);
  }
}

/** Remove tutorial target elements from the DOM. */
function cleanupTargets() {
  for (const name of ["canvas", "layers", "properties", "toolbar"]) {
    const el = document.querySelector(`[data-tutorial="${name}"]`);
    if (el) el.remove();
  }
}

describe("EditorTutorial", () => {
  beforeEach(() => {
    setupTargets();
  });

  afterEach(() => {
    cleanupTargets();
  });

  it("renders first tutorial step", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    expect(screen.getByText("Vorschau")).toBeInTheDocument();
    expect(screen.getByText("1/5")).toBeInTheDocument();
  });

  it("advances through steps on next button click", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    // Step 1
    expect(screen.getByText("Vorschau")).toBeInTheDocument();
    // Click next
    fireEvent.click(screen.getByText("Weiter"));
    // Step 2
    expect(screen.getByText("Ebenen")).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("calls onComplete when finished on last step", () => {
    const onComplete = vi.fn();
    render(<EditorTutorial onComplete={onComplete} />);
    // Advance through all 5 steps (indices 0-4)
    fireEvent.click(screen.getByText("Weiter")); // -> step 2
    fireEvent.click(screen.getByText("Weiter")); // -> step 3
    fireEvent.click(screen.getByText("Weiter")); // -> step 4
    fireEvent.click(screen.getByText("Weiter")); // -> step 5
    // Step 5 (last) shows "Fertig" instead of "Weiter"
    fireEvent.click(screen.getByText("Fertig"));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("calls onComplete when skip is clicked", () => {
    const onComplete = vi.fn();
    render(<EditorTutorial onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Überspringen"));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows finish button text on last step", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    // Advance to last step (index 4, displayed as 5/5)
    fireEvent.click(screen.getByText("Weiter")); // -> step 2
    fireEvent.click(screen.getByText("Weiter")); // -> step 3
    fireEvent.click(screen.getByText("Weiter")); // -> step 4
    fireEvent.click(screen.getByText("Weiter")); // -> step 5
    // Last step should show "Fertig"
    expect(screen.getByText("Fertig")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument();
  });
});
