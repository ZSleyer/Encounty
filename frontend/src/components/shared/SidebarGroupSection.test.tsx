import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { SidebarGroupSection } from "./SidebarGroupSection";
import type { Group } from "../../types";

const makeGroup = (overrides?: Partial<Group>): Group => ({
  id: "g1",
  name: "Legendaries",
  color: "#3b82f6",
  sort_order: 0,
  collapsed: false,
  ...overrides,
});

describe("SidebarGroupSection", () => {
  it("renders the group label and count", () => {
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="Legendaries"
        count={3}
        collapsed={false}
        onToggleCollapse={() => {}}
      >
        <li>child</li>
      </SidebarGroupSection>,
    );
    expect(screen.getByText("Legendaries")).toBeInTheDocument();
    expect(screen.getByText("(3)")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("hides children when collapsed", () => {
    render(
      <SidebarGroupSection
        group={makeGroup({ collapsed: true })}
        label="Legendaries"
        count={3}
        collapsed
        onToggleCollapse={() => {}}
      >
        <li>hidden-child</li>
      </SidebarGroupSection>,
    );
    expect(screen.queryByText("hidden-child")).toBeNull();
  });

  it("invokes onToggleCollapse when the header button is clicked", async () => {
    const onToggle = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={onToggle}
      >
        <li>child</li>
      </SidebarGroupSection>,
    );
    await user.click(screen.getByRole("button", { name: /L/ }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("shows the overflow menu when onAction is provided", async () => {
    const onAction = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onAction={onAction}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    // aria-label uses t("group.manage") = "Gruppen verwalten" in default de locale.
    const menuBtn = screen.getByRole("button", { name: /gruppen verwalten/i });
    await user.click(menuBtn);
    await user.click(screen.getByRole("menuitem", { name: /starten/i }));
    expect(onAction).toHaveBeenCalledWith("start");
  });

  it("omits the overflow menu for the synthetic ungrouped bucket", () => {
    render(
      <SidebarGroupSection
        group={null}
        label="Ungrouped"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    expect(screen.queryByRole("button", { name: /gruppen verwalten/i })).toBeNull();
  });
});
