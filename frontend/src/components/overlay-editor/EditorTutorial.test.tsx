import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { EditorTutorial } from "./EditorTutorial";

/** Every anchor the editor walkthrough points at, in step order. */
const TARGETS = [
  "canvas",
  "template-list",
  "layers",
  "properties",
  "text-style",
  "text-color-type",
  "affixes",
  "sprite-cycle",
  "toolbar",
];

/** Anchors that only exist inside a dialog the walkthrough opens. */
const MODAL_TARGETS: Record<string, string> = {
  "template-list": "templates",
  "text-color-type": "text-color",
};

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
    vi.restoreAllMocks();
  });

  it("renders first tutorial step", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    expect(screen.getByText("Vorschau")).toBeInTheDocument();
    expect(screen.getByText("1/9")).toBeInTheDocument();
  });

  it("advances through steps on next button click", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    expect(screen.getByText("Vorschau")).toBeInTheDocument();
    advance(1);
    expect(screen.getByText("Vorlagen")).toBeInTheDocument();
    expect(screen.getByText("2/9")).toBeInTheDocument();
  });

  it("walks through every step title in order", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    const titles = [
      "Vorschau",
      "Vorlagen",
      "Ebenen",
      "Eigenschaften",
      "Text-Stil",
      "Farbe und Verlauf",
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

  it("names the angle dial on the color step", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    advance(5);
    expect(screen.getByText(/am Winkel-Rad drehst/)).toBeInTheDocument();
  });

  it("names the sprite cycle transitions", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    advance(7);
    expect(screen.getByText(/Überblenden oder Wischen/)).toBeInTheDocument();
  });

  it("selects the layer a step needs before showing it", () => {
    const onSelectElement = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onSelectElement={onSelectElement} />);
    expect(onSelectElement).not.toHaveBeenCalled();
    advance(3);
    expect(onSelectElement).toHaveBeenLastCalledWith("counter");
    advance(4);
    expect(onSelectElement).toHaveBeenLastCalledWith("sprite");
  });

  // --- Dialogs a step points into ---

  it("opens the dialog a step points into when the step is entered", () => {
    const onOpenModal = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />);
    expect(onOpenModal).toHaveBeenLastCalledWith(null);
    advance(1);
    expect(onOpenModal).toHaveBeenLastCalledWith("templates");
  });

  it("opens the color dialog on the color step", () => {
    const onOpenModal = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />);
    advance(5);
    expect(onOpenModal).toHaveBeenLastCalledWith("text-color");
  });

  it("closes the dialog again when the step is left", () => {
    const onOpenModal = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />);
    advance(2);
    expect(onOpenModal).toHaveBeenLastCalledWith(null);
    advance(3);
    expect(onOpenModal).toHaveBeenLastCalledWith("text-color");
    advance(1);
    expect(onOpenModal).toHaveBeenLastCalledWith(null);
  });

  it("closes the dialog when stepping backwards out of the step", () => {
    const onOpenModal = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />);
    advance(1);
    expect(onOpenModal).toHaveBeenLastCalledWith("templates");
    fireEvent.click(screen.getByText("Zurück"));
    expect(screen.getByText("1/9")).toBeInTheDocument();
    expect(onOpenModal).toHaveBeenLastCalledWith(null);
  });

  it("reopens the dialog when stepping backwards into the step", () => {
    const onOpenModal = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />);
    advance(2);
    expect(onOpenModal).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByText("Zurück"));
    expect(screen.getByText("2/9")).toBeInTheDocument();
    expect(onOpenModal).toHaveBeenLastCalledWith("templates");
  });

  it("closes the dialog when the walkthrough is skipped mid-step", () => {
    const onOpenModal = vi.fn();
    const { unmount } = render(
      <EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />,
    );
    advance(1);
    expect(onOpenModal).toHaveBeenLastCalledWith("templates");
    fireEvent.click(screen.getByText("Überspringen"));
    // The host unmounts the walkthrough in response to onComplete.
    unmount();
    expect(onOpenModal).toHaveBeenLastCalledWith(null);
  });

  it("closes the dialog when Escape ends the walkthrough mid-step", () => {
    const onOpenModal = vi.fn();
    const { unmount } = render(
      <EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />,
    );
    advance(5);
    expect(onOpenModal).toHaveBeenLastCalledWith("text-color");
    fireEvent.keyDown(document, { key: "Escape" });
    unmount();
    expect(onOpenModal).toHaveBeenLastCalledWith(null);
  });

  it("names a dialog for every step whose anchor lives in one", () => {
    const onOpenModal = vi.fn();
    render(<EditorTutorial onComplete={vi.fn()} onOpenModal={onOpenModal} />);
    for (const [index, target] of TARGETS.entries()) {
      if (index > 0) advance(1);
      expect(onOpenModal).toHaveBeenLastCalledWith(MODAL_TARGETS[target] ?? null);
    }
  });

  it("re-enters the top layer once the step's dialog is open", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    // The anchor of step 2 lives inside an already open dialog, the same shape
    // the real template picker has by the time the step is measured.
    const host = document.createElement("dialog");
    host.setAttribute("open", "");
    const anchor = document.querySelector('[data-tutorial="template-list"]')!;
    document.body.appendChild(host);
    host.appendChild(anchor);

    render(<EditorTutorial onComplete={vi.fn()} />);
    const afterMount = showModal.mock.calls.length;
    advance(1);
    // Once for getting back on top of the dialog the step points into.
    expect(showModal.mock.calls.length).toBeGreaterThan(afterMount);

    host.remove();
  });

  it("calls onComplete when finished on last step", () => {
    const onComplete = vi.fn();
    render(<EditorTutorial onComplete={onComplete} />);
    advance(8);
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
    advance(8);
    expect(screen.getByText("Fertig")).toBeInTheDocument();
    expect(screen.getByText("9/9")).toBeInTheDocument();
  });

  it("steps back to the previous step", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    // The first step has nothing to go back to, so no back button is offered.
    expect(screen.queryByText("Zurück")).not.toBeInTheDocument();
    advance(2);
    expect(screen.getByText("3/9")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Zurück"));
    expect(screen.getByText("2/9")).toBeInTheDocument();
  });

  it("announces the current step for screen readers", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Schritt 1 von 9");
    advance(1);
    expect(screen.getByRole("status")).toHaveTextContent("Schritt 2 von 9");
  });

  it("labels its dialog with the step title and text", () => {
    render(<EditorTutorial onComplete={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    // A native <dialog> opened with showModal() is modal by the platform's own
    // rules, which is what puts the walkthrough above the dialog a step opens.
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    const text = document.getElementById(dialog.getAttribute("aria-describedby")!);
    expect(title).toHaveTextContent("Vorschau");
    expect(text).toHaveTextContent(/So sieht dein Overlay in OBS aus/);
  });

  it("opens its shell with showModal so it lands in the top layer", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<EditorTutorial onComplete={vi.fn()} />);
    expect(showModal).toHaveBeenCalled();
    expect(showModal.mock.instances[0]).toHaveClass("tutorial-shell");
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

  it("still renders the step when its dialog never opens", () => {
    // The anchor sits in a dialog that stays closed, so it can never be
    // measured. The step has to stay readable and dismissible all the same.
    const host = document.createElement("dialog");
    const anchor = document.querySelector('[data-tutorial="template-list"]')!;
    document.body.appendChild(host);
    host.appendChild(anchor);

    render(<EditorTutorial onComplete={vi.fn()} />);
    advance(1);
    expect(screen.getByText("Vorlagen")).toBeInTheDocument();
    expect(screen.getByText("Überspringen")).toBeVisible();

    host.remove();
  });
});
