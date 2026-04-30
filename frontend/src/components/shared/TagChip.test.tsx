import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { TagChip } from "./TagChip";

describe("TagChip", () => {
  it("renders the tag with a leading #", () => {
    render(<TagChip tag="shiny" />);
    expect(screen.getByText("#shiny")).toBeInTheDocument();
  });

  it("invokes onClick when clicked", async () => {
    const onClick = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<TagChip tag="eggs" onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /eggs/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("supports keyboard activation (Enter/Space)", async () => {
    const onClick = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<TagChip tag="odds" onClick={onClick} />);
    const chip = screen.getByRole("button", { name: /odds/i });
    chip.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalled();
  });

  it("reflects active state via aria-pressed", () => {
    render(<TagChip tag="test" onClick={() => {}} active />);
    expect(screen.getByRole("button", { name: /test/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders a remove button with aria-label when removable", async () => {
    const onRemove = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<TagChip tag="alpha" removable onRemove={onRemove} />);
    const removeBtn = screen.getByRole("button", { name: /alpha/i });
    await user.click(removeBtn);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("produces identical colors for identical tags", () => {
    const { container: c1 } = render(<TagChip tag="same" />);
    const { container: c2 } = render(<TagChip tag="same" />);
    const span1 = c1.querySelector("[data-testid='tag-chip']") as HTMLElement;
    const span2 = c2.querySelector("[data-testid='tag-chip']") as HTMLElement;
    expect(span1.style.backgroundColor).toBe(span2.style.backgroundColor);
  });
});
