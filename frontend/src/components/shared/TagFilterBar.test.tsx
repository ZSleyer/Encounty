import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { TagFilterBar } from "./TagFilterBar";

describe("TagFilterBar", () => {
  it("renders nothing when no tags and no filters", () => {
    render(
      <TagFilterBar
        activeTags={[]}
        availableTags={[]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    // When nothing is renderable we expect no tag chip, no add button, no clear button.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders active filters as removable chips", () => {
    render(
      <TagFilterBar
        activeTags={["shiny"]}
        availableTags={["shiny", "egg"]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("#shiny")).toBeInTheDocument();
  });

  it("clicking a chip X invokes onToggle with that tag", async () => {
    const onToggle = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={["shiny"]}
        availableTags={["shiny"]}
        onToggle={onToggle}
        onClear={vi.fn()}
      />,
    );
    // The remove chip button carries aria-label Tag 'shiny' entfernen (de).
    await user.click(screen.getByRole("button", { name: /shiny/i }));
    expect(onToggle).toHaveBeenCalledWith("shiny");
  });

  it("opens dropdown when + is clicked and adds tags via clicks", async () => {
    const onToggle = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={[]}
        availableTags={["alpha", "beta"]}
        onToggle={onToggle}
        onClear={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tag hinzufügen/i }));
    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems.length).toBe(2);
    await user.click(menuItems[0]);
    expect(onToggle).toHaveBeenCalledWith("alpha");
  });

  it("clear button invokes onClear", async () => {
    const onClear = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={["a"]}
        availableTags={["a", "b"]}
        onToggle={vi.fn()}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByRole("button", { name: /filter zurücksetzen/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it("ArrowDown+Enter selects the next tag from the menu", async () => {
    const onToggle = vi.fn();
    const { userEvent, fireEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={[]}
        availableTags={["alpha", "beta", "gamma"]}
        onToggle={onToggle}
        onClear={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tag hinzufügen/i }));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("beta");
  });

  it("ArrowUp cannot go below 0 and Enter picks the first tag", async () => {
    const onToggle = vi.fn();
    const { userEvent, fireEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={[]}
        availableTags={["alpha", "beta"]}
        onToggle={onToggle}
        onClear={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tag hinzufügen/i }));
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("alpha");
  });

  it("Escape closes the menu", async () => {
    const { userEvent, fireEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={[]}
        availableTags={["alpha"]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tag hinzufügen/i }));
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryAllByRole("menuitem").length).toBe(0);
  });

  it("backdrop click closes the menu", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={[]}
        availableTags={["alpha"]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tag hinzufügen/i }));
    const backdrop = screen.getByRole("button", { name: /schließen/i });
    await user.click(backdrop);
    expect(screen.queryAllByRole("menuitem").length).toBe(0);
  });

  it("hovering an item updates the highlight index", async () => {
    const onToggle = vi.fn();
    const { userEvent, fireEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <TagFilterBar
        activeTags={[]}
        availableTags={["alpha", "beta"]}
        onToggle={onToggle}
        onClear={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tag hinzufügen/i }));
    const items = screen.getAllByRole("menuitem");
    fireEvent.mouseEnter(items[1]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("beta");
  });
});
