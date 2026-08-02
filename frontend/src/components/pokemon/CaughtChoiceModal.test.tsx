import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import { CaughtChoiceModal } from "./CaughtChoiceModal";

HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

/** Renders the dialog with spies for both callbacks. */
function renderModal() {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(
    <CaughtChoiceModal
      targetName="Bisasam"
      phaseNumber={3}
      onChoose={onChoose}
      onClose={onClose}
    />,
  );
  return { onChoose, onClose };
}

describe("CaughtChoiceModal", () => {
  it("offers both branches and names the hunted species", () => {
    renderModal();

    expect(screen.getByText("Was ist passiert?")).toBeInTheDocument();
    expect(screen.getByText(/Du bist in Phase 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bisasam gefangen/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fehl-Shiny gefangen/ })).toBeInTheDocument();
  });

  it("reports the completed hunt after the dialog has closed", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: /Bisasam gefangen/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChoose).toHaveBeenCalledWith("caught");
    // Closing first keeps the follow-up dialog of the phase branch from
    // overlapping with this one.
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onChoose.mock.invocationCallOrder[0],
    );
  });

  it("reports the phase branch", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: /Fehl-Shiny gefangen/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChoose).toHaveBeenCalledWith("phase");
  });

  it("reports nothing when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("explains phasing behind the help toggle", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.queryByText("Was ist Phasing?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Erklärung zu Phasen/ }));

    expect(screen.getByText("Was ist Phasing?")).toBeInTheDocument();
    expect(screen.getByText(/Der Zähler startet dann bei 0/)).toBeInTheDocument();
  });
});
