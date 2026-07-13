import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { useModalDialog, type UseModalDialogOptions } from "./useModalDialog";

// HTMLDialogElement.showModal is not implemented in jsdom
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

/** Minimal consumer rendering a real <dialog> wired to the hook. */
function TestDialog(props: Readonly<UseModalDialogOptions>) {
  const { dialogRef, requestClose } = useModalDialog(props);
  return createElement(
    "dialog",
    { ref: dialogRef, "data-testid": "dlg" },
    createElement("button", { onClick: requestClose }, "close"),
  );
}

function renderDialog(options: UseModalDialogOptions) {
  const utils = render(createElement(TestDialog, options));
  return { ...utils, dialog: utils.getByTestId("dlg") as HTMLDialogElement };
}

describe("useModalDialog", () => {
  it("calls showModal on mount", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    renderDialog({ onClose: vi.fn() });
    expect(showModal).toHaveBeenCalledOnce();
  });

  it("requestClose closes the dialog and calls onClose", () => {
    const onClose = vi.fn();
    const { getByText } = renderDialog({ onClose });
    getByText("close").click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('mode "click": closes when the click target is the dialog itself', () => {
    const onClose = vi.fn();
    const { dialog } = renderDialog({ onClose });
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('mode "click": ignores clicks on children', () => {
    const onClose = vi.fn();
    const { getByText } = renderDialog({ onClose });
    getByText("close").dispatchEvent(
      new MouseEvent("click", { bubbles: false }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mode "mousedown-outside": closes on press outside the dialog rect', () => {
    const onClose = vi.fn();
    const { dialog } = renderDialog({ onClose, backdropClose: "mousedown-outside" });
    dialog.getBoundingClientRect = () =>
      ({ left: 100, right: 200, top: 100, bottom: 200 }) as DOMRect;
    document.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10 }));
    expect(onClose).toHaveBeenCalled();
  });

  it('mode "mousedown-outside": ignores presses inside the dialog rect', () => {
    const onClose = vi.fn();
    const { dialog } = renderDialog({ onClose, backdropClose: "mousedown-outside" });
    dialog.getBoundingClientRect = () =>
      ({ left: 100, right: 200, top: 100, bottom: 200 }) as DOMRect;
    document.dispatchEvent(new MouseEvent("mousedown", { clientX: 150, clientY: 150 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mode "none": backdrop clicks never close', () => {
    const onClose = vi.fn();
    const { dialog } = renderDialog({ onClose, backdropClose: "none" });
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0 }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
