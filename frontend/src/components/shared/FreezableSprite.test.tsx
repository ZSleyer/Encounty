import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { FreezableSprite } from "./FreezableSprite";

/** Fires a window blur and lets React flush the resulting state update. */
function blurWindow() {
  act(() => {
    globalThis.dispatchEvent(new Event("blur"));
  });
}

/** Fires a window focus and lets React flush the resulting state update. */
function focusWindow() {
  act(() => {
    globalThis.dispatchEvent(new Event("focus"));
  });
}

describe("FreezableSprite", () => {
  // jsdom reports document.hasFocus() as false, which would make every sprite
  // start out frozen. Real windows mount focused, so that is what is tested.
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a plain image and no canvas while focused", () => {
    const { container } = render(
      <FreezableSprite src="https://example.test/ani-shiny/fletchling.gif" alt="Fletchling" />,
    );
    expect(screen.getByAltText("Fletchling")).toBeInTheDocument();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("mounts a canvas for an animated sprite once the window loses focus", () => {
    const { container } = render(
      <FreezableSprite src="https://example.test/ani-shiny/fletchling.gif" alt="Fletchling" />,
    );
    blurWindow();
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("leaves static sprites untouched on blur", () => {
    const { container } = render(
      <FreezableSprite src="https://example.test/box/fletchling.png" alt="Fletchling" />,
    );
    blurWindow();
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByAltText("Fletchling")).toBeInTheDocument();
  });

  it("never exposes the sprite name twice, even when no frame could be captured", () => {
    render(
      <FreezableSprite src="https://example.test/ani-shiny/fletchling.gif" alt="Fletchling" />,
    );
    blurWindow();
    // jsdom decodes nothing, so naturalWidth stays 0 and the snapshot cannot be
    // taken. The image must keep the name and the empty canvas must stay silent,
    // otherwise queries by name would match two elements.
    expect(screen.getAllByAltText("Fletchling")).toHaveLength(1);
    expect(screen.queryAllByLabelText("Fletchling")).toHaveLength(0);
  });
});
