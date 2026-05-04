import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { SetTimerModal } from "./SetTimerModal";

// HTMLDialogElement.showModal is not implemented in jsdom
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

function getField(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

describe("SetTimerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("splits currentMs into hours, minutes and seconds inputs", () => {
    // 1h 23m 45s = 3600000 + 23*60000 + 45000 = 5025000
    render(<SetTimerModal currentMs={5025000} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(getField("timer-hours").value).toBe("1");
    expect(getField("timer-minutes").value).toBe("23");
    expect(getField("timer-seconds").value).toBe("45");
  });

  it("saves the assembled duration in milliseconds", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SetTimerModal currentMs={0} onSave={onSave} onClose={onClose} />);

    fireEvent.change(getField("timer-hours"), { target: { value: "2" } });
    fireEvent.change(getField("timer-minutes"), { target: { value: "5" } });
    fireEvent.change(getField("timer-seconds"), { target: { value: "30" } });

    fireEvent.click(screen.getByText(/^Speichern$|^Save$/));

    expect(onSave).toHaveBeenCalledWith(2 * 3600000 + 5 * 60000 + 30 * 1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clamps minutes and seconds to 0–59", () => {
    const onSave = vi.fn();
    render(<SetTimerModal currentMs={0} onSave={onSave} onClose={vi.fn()} />);

    const minutesInput = getField("timer-minutes");
    fireEvent.change(minutesInput, { target: { value: "99" } });
    expect(minutesInput.value).toBe("59");

    const secondsInput = getField("timer-seconds");
    fireEvent.change(secondsInput, { target: { value: "-5" } });
    expect(secondsInput.value).toBe("0");

    fireEvent.click(screen.getByText(/^Speichern$|^Save$/));
    expect(onSave).toHaveBeenCalledWith(59 * 60000);
  });

  it("treats non-numeric input as zero", () => {
    render(<SetTimerModal currentMs={0} onSave={vi.fn()} onClose={vi.fn()} />);
    const hours = getField("timer-hours");
    fireEvent.change(hours, { target: { value: "abc" } });
    expect(hours.value).toBe("0");
  });

  it("cancel button closes without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SetTimerModal currentMs={60000} onSave={onSave} onClose={onClose} />);

    fireEvent.click(screen.getByText(/^Abbrechen$|^Cancel$/));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close icon (aria-label) closes without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SetTimerModal currentMs={0} onSave={onSave} onClose={onClose} />);

    const closeBtn = screen.getByLabelText(/Schließen|Close/i);
    fireEvent.click(closeBtn);

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter in an input triggers save", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SetTimerModal currentMs={3600000} onSave={onSave} onClose={onClose} />);
    fireEvent.keyDown(getField("timer-hours"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(3600000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the dialog backdrop closes without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SetTimerModal currentMs={0} onSave={onSave} onClose={onClose} />);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    // Simulate a click whose target is the dialog itself (backdrop area).
    fireEvent.click(dialog, { target: dialog });
    expect(onSave).not.toHaveBeenCalled();
  });
});
