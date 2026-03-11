import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../test-utils";
import { ConfirmModal } from "./ConfirmModal";

// HTMLDialogElement.showModal is not implemented in jsdom
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

describe("ConfirmModal", () => {
  it("renders title and message", () => {
    render(
      <ConfirmModal
        title="Delete?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("renders custom button labels", () => {
    render(
      <ConfirmModal
        title="Confirm"
        message="Sure?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const { userEvent } = await import("../test-utils");
    const user = userEvent.setup();
    render(
      <ConfirmModal
        title="Confirm"
        message="Sure?"
        confirmLabel="OK"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByText("OK"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onClose when cancel button is clicked", async () => {
    const onClose = vi.fn();
    const { userEvent } = await import("../test-utils");
    const user = userEvent.setup();
    render(
      <ConfirmModal
        title="Confirm"
        message="Sure?"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
