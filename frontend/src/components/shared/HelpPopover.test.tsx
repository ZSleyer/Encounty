import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { HelpPopover } from "./HelpPopover";

/** Renders a popover with fixed label, title and body text. */
function renderPopover() {
  return render(
    <div>
      <button type="button">outside</button>
      <HelpPopover label="Erklärung anzeigen" title="Was ist Phasing?">
        Eine Phase endet mit einem fremden Shiny.
      </HelpPopover>
    </div>,
  );
}

describe("HelpPopover", () => {
  it("keeps the explanation collapsed until the toggle is pressed", async () => {
    const user = userEvent.setup();
    renderPopover();

    const toggle = screen.getByRole("button", { name: "Erklärung anzeigen" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Was ist Phasing?")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Was ist Phasing?")).toBeInTheDocument();
    expect(screen.getByText("Eine Phase endet mit einem fremden Shiny.")).toBeInTheDocument();
  });

  it("points the toggle at the panel it controls", async () => {
    const user = userEvent.setup();
    renderPopover();

    const toggle = screen.getByRole("button", { name: "Erklärung anzeigen" });
    await user.click(toggle);

    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toBeInTheDocument();
  });

  it("closes again on a second press of the toggle", async () => {
    const user = userEvent.setup();
    renderPopover();

    const toggle = screen.getByRole("button", { name: "Erklärung anzeigen" });
    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Was ist Phasing?")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns the focus to the toggle", async () => {
    const user = userEvent.setup();
    renderPopover();

    const toggle = screen.getByRole("button", { name: "Erklärung anzeigen" });
    await user.click(toggle);
    await user.keyboard("{Escape}");

    expect(screen.queryByText("Was ist Phasing?")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("closes when the press lands outside the popover", async () => {
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole("button", { name: "Erklärung anzeigen" }));
    await user.click(screen.getByRole("button", { name: "outside" }));

    expect(screen.queryByText("Was ist Phasing?")).not.toBeInTheDocument();
  });

  it("closes from the close button inside the panel", async () => {
    const user = userEvent.setup();
    renderPopover();

    const toggle = screen.getByRole("button", { name: "Erklärung anzeigen" });
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Schließen" }));

    expect(screen.queryByText("Was ist Phasing?")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("swallows the Escape that closes it, so a surrounding dialog stays open", async () => {
    const user = userEvent.setup();
    const onDialogEscape = vi.fn();
    document.addEventListener("keydown", onDialogEscape);

    renderPopover();
    await user.click(screen.getByRole("button", { name: "Erklärung anzeigen" }));
    await user.keyboard("{Escape}");

    document.removeEventListener("keydown", onDialogEscape);
    // The capturing listener of the popover stops the event before it reaches
    // any bubble-phase listener further out.
    expect(onDialogEscape).not.toHaveBeenCalled();
  });
});
