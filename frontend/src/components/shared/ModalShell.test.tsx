import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { ModalShell, ModalActions } from "./ModalShell";

// HTMLDialogElement.showModal is not implemented in jsdom
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

describe("ModalShell", () => {
  it("renders title wired to the dialog via aria-labelledby", () => {
    const { container } = render(
      <ModalShell title="My Modal" onClose={vi.fn()}>
        <p>body</p>
      </ModalShell>,
    );
    const dialog = container.querySelector("dialog")!;
    // showModal is mocked, so the dialog lacks `open` and jsdom hides its
    // content from the accessibility tree; query hidden elements explicitly.
    const heading = screen.getByRole("heading", { name: "My Modal", hidden: true });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("closes via the X button", async () => {
    const onClose = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <ModalShell title="T" onClose={onClose}>
        <p>body</p>
      </ModalShell>,
    );
    await user.click(
      screen.getByRole("button", { name: /schließen|close/i, hidden: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on backdrop click by default", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell title="T" onClose={onClose}>
        <p>body</p>
      </ModalShell>,
    );
    container.querySelector("dialog")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on backdrop click with backdropClose="none"', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell title="T" onClose={onClose} backdropClose="none">
        <p>body</p>
      </ModalShell>,
    );
    container.querySelector("dialog")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("applies danger skin when destructive", () => {
    const { container } = render(
      <ModalShell title="T" onClose={vi.fn()} destructive>
        <p>body</p>
      </ModalShell>,
    );
    expect(container.querySelector("dialog")!.className).toContain("t-panel--danger");
  });

  it("passes a working requestClose to a footer function", async () => {
    const onClose = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <ModalShell
        title="T"
        onClose={onClose}
        footer={(requestClose) => <button onClick={requestClose}>done</button>}
      >
        <p>body</p>
      </ModalShell>,
    );
    await user.click(screen.getByText("done"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders a scrollable body row when structured", () => {
    const { container } = render(
      <ModalShell title="T" onClose={vi.fn()} structured>
        <p>body</p>
      </ModalShell>,
    );
    const dialog = container.querySelector("dialog")!;
    expect(dialog.className).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(container.querySelector(".overflow-y-auto")).toBeInTheDocument();
  });
});

describe("ModalActions", () => {
  it("runs onConfirm then requestClose on confirm", async () => {
    const calls: string[] = [];
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <ModalActions
        onConfirm={() => calls.push("confirm")}
        requestClose={() => calls.push("close")}
        confirmLabel="OK"
      />,
    );
    await user.click(screen.getByText("OK"));
    expect(calls).toEqual(["confirm", "close"]);
  });

  it("only closes on cancel", async () => {
    const onConfirm = vi.fn();
    const requestClose = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <ModalActions
        onConfirm={onConfirm}
        requestClose={requestClose}
        cancelLabel="Nope"
      />,
    );
    await user.click(screen.getByText("Nope"));
    expect(requestClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables confirm via confirmDisabled", () => {
    render(
      <ModalActions
        onConfirm={vi.fn()}
        requestClose={vi.fn()}
        confirmLabel="Go"
        confirmDisabled
      />,
    );
    expect(screen.getByText("Go")).toBeDisabled();
  });
});
