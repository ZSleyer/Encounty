import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { RegionPicker } from "./RegionPicker";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["fake"], { type: "image/png" })),
    }),
  ),
);

// URL.createObjectURL / revokeObjectURL are not available in jsdom
vi.stubGlobal("URL", {
  ...globalThis.URL,
  createObjectURL: vi.fn(() => "blob:fake-url"),
  revokeObjectURL: vi.fn(),
});

describe("RegionPicker", () => {
  it("renders without crashing", () => {
    render(
      <RegionPicker
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Should render buttons for cancel, confirm, reload
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
