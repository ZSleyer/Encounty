/**
 * CloseTabWarning.test.tsx: the Ctrl+W guard, which is built on the shared
 * ConfirmModal. Covers the two exits (stay, quit) and the rule that only an
 * explicit choice may quit, since quitting the backend stops a running hunt.
 *
 * Queries go through the visible text rather than roles: jsdom has no
 * showModal(), so the stubbed <dialog> never reports itself as open and its
 * contents stay out of the accessibility tree.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, userEvent } from "../test-utils";
import { CloseTabWarning } from "./CloseTabWarning";

// HTMLDialogElement.showModal is not implemented in jsdom.
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

describe("CloseTabWarning", () => {
  it("shows the warning and both choices", () => {
    render(<CloseTabWarning onStay={vi.fn()} onQuit={vi.fn()} />);

    expect(screen.getByText("Tab nicht schließen")).toBeInTheDocument();
    expect(screen.getByText("Tab offen lassen")).toBeInTheDocument();
    expect(screen.getByText("Beenden und schließen")).toBeInTheDocument();
  });

  it("calls onStay when the stay button is clicked", async () => {
    const onStay = vi.fn();
    const onQuit = vi.fn();
    const user = userEvent.setup();
    render(<CloseTabWarning onStay={onStay} onQuit={onQuit} />);

    await user.click(screen.getByText("Tab offen lassen"));

    expect(onStay).toHaveBeenCalledOnce();
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("calls onQuit when the quit button is clicked", async () => {
    const onStay = vi.fn();
    const onQuit = vi.fn();
    const user = userEvent.setup();
    render(<CloseTabWarning onStay={onStay} onQuit={onQuit} />);

    await user.click(screen.getByText("Beenden und schließen"));

    expect(onQuit).toHaveBeenCalledOnce();
    // The shared footer closes the dialog after confirming, and closing is what
    // this component reports as staying. Quitting must not do both.
    expect(onStay).not.toHaveBeenCalled();
  });

  it("treats Escape as staying, not quitting", () => {
    const onStay = vi.fn();
    const onQuit = vi.fn();
    const { container } = render(<CloseTabWarning onStay={onStay} onQuit={onQuit} />);

    fireEvent(container.querySelector("dialog")!, new Event("cancel", { bubbles: true }));

    expect(onStay).toHaveBeenCalledOnce();
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("ignores a click on the backdrop", () => {
    const onStay = vi.fn();
    const onQuit = vi.fn();
    const { container } = render(<CloseTabWarning onStay={onStay} onQuit={onQuit} />);

    fireEvent.click(container.querySelector("dialog")!);

    expect(onQuit).not.toHaveBeenCalled();
    expect(onStay).not.toHaveBeenCalled();
  });
});
