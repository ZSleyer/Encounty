import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { EditorTutorial } from "./EditorTutorial";

/** Every anchor the editor walkthrough points at, in step order. */
const TARGETS = [
  "canvas",
  "templates",
  "layers",
  "properties",
  "text-style",
  "affixes",
  "sprite-cycle",
  "toolbar",
];

/** Create stub tutorial target elements so the component can find its anchors. */
function setupTargets() {
  for (const name of TARGETS) {
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
  for (const el of document.querySelectorAll("[data-tutorial]")) {
    el.remove();
  }
}

/** Click "Weiter" the given number of times. */
function advance(times: number) {
  for (let i = 0; i < times; i++) {
    fireEvent.click(screen.getByText("Weiter"));
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
    expect(screen.getByText("1/8")).toBeInTheDocument();
  });

  it("advances through steps on next button click", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    expect(screen.getByText("Vorschau")).toBeInTheDocument();
    advance(1);
    expect(screen.getByText("Vorlagen")).toBeInTheDocument();
    expect(screen.getByText("2/8")).toBeInTheDocument();
  });

  it("walks through every step title in order", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    const titles = [
      "Vorschau",
      "Vorlagen",
      "Ebenen",
      "Eigenschaften",
      "Text-Stil",
      "Text davor & danach",
      "Sprite wechseln",
      "Werkzeugleiste",
    ];
    for (const [index, title] of titles.entries()) {
      expect(screen.getByText(title)).toBeInTheDocument();
      if (index < titles.length - 1) advance(1);
    }
  });

  it("names the templates picker on its own step", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    advance(1);
    expect(
      screen.getByText(/Eine Vorlage ersetzt dein aktuelles Layout/),
    ).toBeInTheDocument();
  });

  it("warns that a font from this PC stays on this PC", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    advance(4);
    expect(
      screen.getByText(/nur in einer OBS Browser Source auf diesem PC/),
    ).toBeInTheDocument();
  });

  it("names the sprite cycle transitions", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    advance(6);
    expect(screen.getByText(/Überblenden oder Wischen/)).toBeInTheDocument();
  });

  it("selects the layer a step needs before showing it", () => {
    const onSelectElement = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onSelectElement={onSelectElement} />);
    expect(onSelectElement).not.toHaveBeenCalled();
    advance(3);
    expect(onSelectElement).toHaveBeenLastCalledWith("counter");
    advance(3);
    expect(onSelectElement).toHaveBeenLastCalledWith("sprite");
  });

  it("calls onComplete when finished on last step", () => {
    const onComplete = vi.fn();
    render(<EditorTutorial onComplete={onComplete} />);
    advance(7);
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
    advance(7);
    expect(screen.getByText("Fertig")).toBeInTheDocument();
    expect(screen.getByText("8/8")).toBeInTheDocument();
  });

  it("steps back to the previous step", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    // The first step has nothing to go back to, so no back button is offered.
    expect(screen.queryByText("Zurück")).not.toBeInTheDocument();
    advance(2);
    expect(screen.getByText("3/8")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Zurück"));
    expect(screen.getByText("2/8")).toBeInTheDocument();
  });

  it("announces the current step for screen readers", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Schritt 1 von 8");
    advance(1);
    expect(screen.getByRole("status")).toHaveTextContent("Schritt 2 von 8");
  });

  it("labels its dialog with the step title and text", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    const text = document.getElementById(dialog.getAttribute("aria-describedby")!);
    expect(title).toHaveTextContent("Vorschau");
    expect(text).toHaveTextContent(/So sieht dein Overlay in OBS aus/);
  });

  it("closes on Escape", () => {
    const onComplete = vi.fn();
    render(<EditorTutorial onComplete={onComplete} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("still renders the step when its anchor is missing", () => {
    cleanupTargets();
    render(<EditorTutorial onComplete={vi.fn()} />);
    expect(screen.getByText("Vorschau")).toBeInTheDocument();
    expect(screen.getByText("Überspringen")).toBeVisible();
  });
});
