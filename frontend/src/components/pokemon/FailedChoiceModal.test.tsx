import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test-utils";
import { FailedChoiceModal } from "./FailedChoiceModal";

function renderModal() {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(<FailedChoiceModal targetName="Bisasam" phaseNumber={3} onChoose={onChoose} onClose={onClose} />);
  return { onChoose, onClose };
}

describe("FailedChoiceModal", () => {
  it("routes a foreign shiny and cancellation", async () => {
    const user = userEvent.setup();
    const first = renderModal();
    await user.click(screen.getByRole("button", { name: /Fehl-Shiny/ }));
    await waitFor(() => expect(first.onChoose).toHaveBeenCalledWith("phase"));

    const second = renderModal();
    await user.click(screen.getAllByRole("button", { name: "Abbrechen" }).slice(-1)[0]);
    await waitFor(() => expect(second.onClose).toHaveBeenCalled());
    expect(second.onChoose).not.toHaveBeenCalled();
  });

  it("offers both target scopes and can go back", async () => {
    const user = userEvent.setup();
    const { onChoose } = renderModal();
    await user.click(screen.getByRole("button", { name: /Bisasam/ }));
    await user.click(screen.getByRole("button", { name: "Zurück" }));
    await user.click(screen.getByRole("button", { name: /Bisasam/ }));
    await user.click(screen.getByRole("button", { name: /Phase/ }));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith("targetPhase"));
  });

  it("can end the whole hunt", async () => {
    const user = userEvent.setup();
    const { onChoose } = renderModal();
    await user.click(screen.getByRole("button", { name: /Bisasam/ }));
    await user.click(screen.getByRole("button", { name: /ganze Hunt/ }));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith("target"));
  });
});
