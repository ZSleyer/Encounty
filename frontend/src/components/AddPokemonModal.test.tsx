import { describe, it, expect, vi } from "vitest";
import { render } from "../test-utils";
import { AddPokemonModal } from "./AddPokemonModal";

// HTMLDialogElement.showModal is not implemented in jsdom
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  ),
);

describe("AddPokemonModal", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <AddPokemonModal onAdd={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector("dialog")).toBeInTheDocument();
  });

  it("renders cancel and add buttons inside the dialog", () => {
    const { container } = render(
      <AddPokemonModal onAdd={vi.fn()} onClose={vi.fn()} />,
    );
    const buttons = container.querySelectorAll("dialog button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
