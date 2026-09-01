import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { AngleDial } from "./AngleDial";

/** Dial geometry used by every pointer test: 100x100 box centred on (50, 50). */
const RECT = {
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  x: 0,
  y: 0,
  right: 100,
  bottom: 100,
  toJSON: () => {},
};

/** Stubs the dial's box so jsdom's all-zero rect does not break the math. */
function stubDial(dial: HTMLElement) {
  vi.spyOn(dial, "getBoundingClientRect").mockReturnValue(RECT as DOMRect);
}

/**
 * Point on the dial for a CSS gradient angle: 0 is straight up, 90 is right.
 * Screen Y grows downward, hence the negated cosine.
 */
function pointAt(deg: number, radius = 40) {
  const rad = (deg * Math.PI) / 180;
  return {
    clientX: 50 + radius * Math.sin(rad),
    clientY: 50 - radius * Math.cos(rad),
  };
}

function setup(value: number, onChange = vi.fn(), step?: number) {
  const utils = render(<AngleDial value={value} label="Winkel" onChange={onChange} step={step} />);
  const dial = screen.getByRole("slider");
  stubDial(dial);
  return { ...utils, dial, onChange };
}

describe("AngleDial", () => {
  describe("rendering and ARIA", () => {
    it("renders the label, the dial and the numeric field", () => {
      setup(90);
      expect(screen.getByText("Winkel")).toBeInTheDocument();
      expect(screen.getByRole("slider")).toBeInTheDocument();
      expect(screen.getByRole("spinbutton")).toHaveValue(90);
    });

    it("exposes the slider ARIA contract", () => {
      const { dial } = setup(135);
      expect(dial).toHaveAttribute("aria-valuenow", "135");
      expect(dial).toHaveAttribute("aria-valuemin", "0");
      expect(dial).toHaveAttribute("aria-valuemax", "359");
      expect(dial).toHaveAttribute("aria-valuetext", "135 Grad");
      expect(dial).toHaveAttribute("tabindex", "0");
      expect(dial).toHaveAccessibleName("Winkel");
    });

    it("gives the numeric input its own accessible name", () => {
      setup(0);
      expect(screen.getByRole("spinbutton")).toHaveAccessibleName("Winkel in Grad");
    });

    it("rotates the handle by the value, so 0 points up and 90 points right", () => {
      const { container } = setup(135);
      expect(container.querySelector('[style*="rotate(135deg)"]')).toBeInTheDocument();
    });

    it("disables the handle transition under prefers-reduced-motion", () => {
      const { container } = setup(45);
      expect(container.querySelector(".motion-reduce\\:transition-none")).toBeInTheDocument();
    });
  });

  describe("normalisation", () => {
    it("wraps an out-of-range value prop instead of clamping it", () => {
      const { dial } = setup(370);
      expect(dial).toHaveAttribute("aria-valuenow", "10");
      expect(screen.getByRole("spinbutton")).toHaveValue(10);
    });

    it("wraps a negative value prop", () => {
      const { dial } = setup(-30);
      expect(dial).toHaveAttribute("aria-valuenow", "330");
    });

    it("wraps 360 back to 0", () => {
      const { dial } = setup(360);
      expect(dial).toHaveAttribute("aria-valuenow", "0");
    });

    it("wraps a typed angle above 359", () => {
      const { onChange } = setup(0);
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "370" } });
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it("wraps a typed negative angle", () => {
      const { onChange } = setup(0);
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "-30" } });
      expect(onChange).toHaveBeenCalledWith(330);
    });

    it("passes an in-range typed angle through unchanged", () => {
      const { onChange } = setup(0);
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "45" } });
      expect(onChange).toHaveBeenCalledWith(45);
    });

    it("ignores an emptied numeric field", () => {
      const { onChange } = setup(45);
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps the numeric field in sync with the value prop", () => {
      const onChange = vi.fn();
      const { rerender } = render(<AngleDial value={10} label="Winkel" onChange={onChange} />);
      rerender(<AngleDial value={200} label="Winkel" onChange={onChange} />);
      expect(screen.getByRole("spinbutton")).toHaveValue(200);
    });
  });

  describe("keyboard", () => {
    it.each([
      ["ArrowRight", 91],
      ["ArrowUp", 91],
      ["ArrowLeft", 89],
      ["ArrowDown", 89],
      ["PageUp", 135],
      ["PageDown", 45],
    ])("%s moves the angle to %i", (key, expected) => {
      const { dial, onChange } = setup(90);
      fireEvent.keyDown(dial, { key });
      expect(onChange).toHaveBeenCalledWith(expected);
    });

    it.each([
      ["ArrowRight", 105],
      ["ArrowUp", 105],
      ["ArrowLeft", 75],
      ["ArrowDown", 75],
    ])("Shift + %s moves 15 degrees to %i", (key, expected) => {
      const { dial, onChange } = setup(90);
      fireEvent.keyDown(dial, { key, shiftKey: true });
      expect(onChange).toHaveBeenCalledWith(expected);
    });

    it("Home jumps to 0", () => {
      const { dial, onChange } = setup(123);
      fireEvent.keyDown(dial, { key: "Home" });
      expect(onChange).toHaveBeenCalledWith(0);
    });

    it("End jumps to 359", () => {
      const { dial, onChange } = setup(123);
      fireEvent.keyDown(dial, { key: "End" });
      expect(onChange).toHaveBeenCalledWith(359);
    });

    it("uses the custom step for arrow keys", () => {
      const { dial, onChange } = setup(90, vi.fn(), 10);
      fireEvent.keyDown(dial, { key: "ArrowRight" });
      expect(onChange).toHaveBeenCalledWith(100);
    });

    it("keeps the 15 degree Shift step even with a custom step", () => {
      const { dial, onChange } = setup(90, vi.fn(), 10);
      fireEvent.keyDown(dial, { key: "ArrowRight", shiftKey: true });
      expect(onChange).toHaveBeenCalledWith(105);
    });

    it("wraps below 0 instead of clamping", () => {
      const { dial, onChange } = setup(0);
      fireEvent.keyDown(dial, { key: "ArrowLeft" });
      expect(onChange).toHaveBeenCalledWith(359);
    });

    it("wraps above 359 instead of clamping", () => {
      const { dial, onChange } = setup(359);
      fireEvent.keyDown(dial, { key: "ArrowRight" });
      expect(onChange).toHaveBeenCalledWith(0);
    });

    it("ignores unrelated keys", () => {
      const { dial, onChange } = setup(90);
      fireEvent.keyDown(dial, { key: "a" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("pointer drag", () => {
    it.each([
      [0, "up"],
      [90, "right"],
      [180, "down"],
      [270, "left"],
      [45, "up-right"],
    ])("reports %i degrees when the pointer points %s", (expected) => {
      const { dial, onChange } = setup(0);
      fireEvent.pointerDown(dial, { pointerId: 1, ...pointAt(expected) });
      expect(onChange).toHaveBeenCalledWith(expected);
    });

    it("keeps tracking while the pointer moves", () => {
      const { dial, onChange } = setup(0);
      fireEvent.pointerDown(dial, { pointerId: 1, ...pointAt(0) });
      fireEvent.pointerMove(dial, { pointerId: 1, ...pointAt(120) });
      fireEvent.pointerMove(dial, { pointerId: 1, ...pointAt(300) });
      expect(onChange).toHaveBeenNthCalledWith(1, 0);
      expect(onChange).toHaveBeenNthCalledWith(2, 120);
      expect(onChange).toHaveBeenNthCalledWith(3, 300);
    });

    it("ignores pointer moves before a drag starts", () => {
      const { dial, onChange } = setup(0);
      fireEvent.pointerMove(dial, { pointerId: 1, ...pointAt(120) });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("stops tracking after the pointer is released", () => {
      const { dial, onChange } = setup(0);
      fireEvent.pointerDown(dial, { pointerId: 1, ...pointAt(90) });
      fireEvent.pointerUp(dial, { pointerId: 1 });
      onChange.mockClear();
      fireEvent.pointerMove(dial, { pointerId: 1, ...pointAt(180) });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("snaps to the step while dragging", () => {
      const { dial, onChange } = setup(0, vi.fn(), 10);
      fireEvent.pointerDown(dial, { pointerId: 1, ...pointAt(98) });
      expect(onChange).toHaveBeenCalledWith(100);
    });

    it("snaps to 15 degrees while Shift is held", () => {
      const { dial, onChange } = setup(0);
      fireEvent.pointerDown(dial, { pointerId: 1, shiftKey: true, ...pointAt(98) });
      expect(onChange).toHaveBeenCalledWith(105);
    });

    it("wraps a negative pointer angle into the 0 to 359 range", () => {
      const { dial, onChange } = setup(0);
      // Up and slightly left is -20 degrees in atan2 terms, 340 in CSS terms.
      fireEvent.pointerDown(dial, { pointerId: 1, ...pointAt(340) });
      expect(onChange).toHaveBeenCalledWith(340);
    });

    it("ignores a pointer resting exactly on the centre", () => {
      const { dial, onChange } = setup(0);
      fireEvent.pointerDown(dial, { pointerId: 1, clientX: 50, clientY: 50 });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
