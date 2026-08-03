import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent, fireEvent } from "../../test-utils";
import { DetectorTutorial } from "./DetectorTutorial";

/** Every anchor the detector walkthrough points at, in step order. */
const TARGETS = ["source", "preview", "templates", "settings", "controls"];

/** Create stub tutorial target elements so the component can find its anchors. */
function addTutorialTargets() {
  for (const name of TARGETS) {
    const el = document.createElement("div");
    el.dataset.detectorTutorial = name;
    el.style.width = "100px";
    el.style.height = "50px";
    document.body.appendChild(el);
  }
}

function removeTutorialTargets() {
  for (const el of document.querySelectorAll("[data-detector-tutorial]")) {
    el.remove();
  }
}

describe("DetectorTutorial", () => {
  beforeEach(() => addTutorialTargets());
  afterEach(() => removeTutorialTargets());

  it("renders first step content", () => {
    render(<DetectorTutorial onComplete={vi.fn()} />);
    // Step counter should show "1/5"
    expect(screen.getByText("1/5")).toBeInTheDocument();
    // First step title (German)
    expect(screen.getByText("Quelle auswählen")).toBeInTheDocument();
  });

  it("advances to next step on next button click", async () => {
    const user = userEvent.setup();
    render(<DetectorTutorial onComplete={vi.fn()} />);

    // "Weiter" is the German next button text
    await user.click(screen.getByText("Weiter"));
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("walks through every step title in order", async () => {
    const user = userEvent.setup();
    render(<DetectorTutorial onComplete={vi.fn()} />);
    const titles = [
      "Quelle auswählen",
      "Live-Vorschau",
      "Templates",
      "Verlauf & Einstellungen",
      "Hunt starten",
    ];
    for (const [index, title] of titles.entries()) {
      expect(screen.getByText(title)).toBeInTheDocument();
      if (index < titles.length - 1) await user.click(screen.getByText("Weiter"));
    }
  });

  it("describes the per-template settings behind the tabs", async () => {
    const user = userEvent.setup();
    render(<DetectorTutorial onComplete={vi.fn()} />);
    for (let i = 0; i < 3; i++) await user.click(screen.getByText("Weiter"));
    expect(
      screen.getByText(/Einstellungen des aktiven Templates/),
    ).toBeInTheDocument();
  });

  it("calls onComplete on last step", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<DetectorTutorial onComplete={onComplete} />);

    // Navigate through all 5 steps: click "Weiter" 4 times, then "Fertig"
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByText("Weiter"));
    }
    expect(screen.getByText("5/5")).toBeInTheDocument();

    // Last step shows "Fertig" instead of "Weiter"
    await user.click(screen.getByText("Fertig"));
    expect(onComplete).toHaveBeenCalled();
  });

  it("calls onComplete when skip button clicked", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<DetectorTutorial onComplete={onComplete} />);

    // "Überspringen" is the German skip button text
    await user.click(screen.getByText("Überspringen"));
    expect(onComplete).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onComplete = vi.fn();
    render(<DetectorTutorial onComplete={onComplete} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("announces the current step for screen readers", async () => {
    const user = userEvent.setup();
    render(<DetectorTutorial onComplete={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Schritt 1 von 5");
    await user.click(screen.getByText("Weiter"));
    expect(screen.getByRole("status")).toHaveTextContent("Schritt 2 von 5");
  });
});
