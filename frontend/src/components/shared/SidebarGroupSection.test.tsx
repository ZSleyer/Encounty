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

  it("stop, rename, color and delete actions are dispatched correctly", async () => {
    const onAction = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    const open = async () => {
      await user.click(screen.getByRole("button", { name: /gruppen verwalten/i }));
    };

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

    await open();
    await user.click(screen.getByRole("menuitem", { name: /stoppen/i }));
    expect(onAction).toHaveBeenLastCalledWith("stop");

    await open();
    await user.click(screen.getByRole("menuitem", { name: /umbenennen/i }));
    expect(onAction).toHaveBeenLastCalledWith("rename");

    await open();
    await user.click(screen.getByRole("menuitem", { name: /farbe/i }));
    expect(onAction).toHaveBeenLastCalledWith("color");

    await open();
    await user.click(screen.getByRole("menuitem", { name: /löschen/i }));
    expect(onAction).toHaveBeenLastCalledWith("delete");
  });

  it("Escape closes the overflow menu", async () => {
    const { userEvent, fireEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onAction={vi.fn()}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    await user.click(screen.getByRole("button", { name: /gruppen verwalten/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("portals the open menu to document.body so it escapes the sticky header", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    const { container } = render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onAction={vi.fn()}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    await user.click(screen.getByRole("button", { name: /gruppen verwalten/i }));
    const menu = screen.getByRole("menu");
    expect(document.body.contains(menu)).toBe(true);
    // The menu must NOT be a descendant of the rendered component subtree —
    // that guarantees it cannot inherit the sticky header's stacking context.
    expect(container.contains(menu)).toBe(false);
  });

  it("backdrop click closes the overflow menu", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onAction={vi.fn()}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    await user.click(screen.getByRole("button", { name: /gruppen verwalten/i }));
    const backdrop = screen.getByRole("button", { name: /schließen/i });
    await user.click(backdrop);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("omits the view-group button when onShowGroupView is not passed", () => {
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    expect(screen.queryByRole("button", { name: /gruppe anzeigen/i })).toBeNull();
  });

  it("invokes onShowGroupView when the view-group button is clicked", async () => {
    const onShowGroupView = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onShowGroupView={onShowGroupView}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    await user.click(screen.getByRole("button", { name: /gruppe anzeigen/i }));
    expect(onShowGroupView).toHaveBeenCalled();
  });

  it("omits the hotkey-target button for the synthetic ungrouped bucket even when onSetHotkeyTarget is passed", () => {
    render(
      <SidebarGroupSection
        group={null}
        label="Ungrouped"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onSetHotkeyTarget={() => {}}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    expect(screen.queryByRole("button", { name: /hotkey-ziel/i })).toBeNull();
  });

  it("shows the inactive hotkey-target state and invokes onSetHotkeyTarget on click", async () => {
    const onSetHotkeyTarget = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onSetHotkeyTarget={onSetHotkeyTarget}
        isHotkeyTarget={false}
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    const inactiveBtn = screen.getByRole("button", { name: /als hotkey-ziel setzen/i });
    expect(inactiveBtn).toHaveAttribute("aria-pressed", "false");
    await user.click(inactiveBtn);
    expect(onSetHotkeyTarget).toHaveBeenCalled();
  });

  it("shows the active hotkey-target state", () => {
    render(
      <SidebarGroupSection
        group={makeGroup()}
        label="L"
        count={1}
        collapsed={false}
        onToggleCollapse={() => {}}
        onSetHotkeyTarget={() => {}}
        isHotkeyTarget
      >
        <li>c</li>
      </SidebarGroupSection>,
    );
    const activeBtn = screen.getByRole("button", { name: /hotkey-ziel \(klicken zum entfernen\)/i });
    expect(activeBtn).toHaveAttribute("aria-pressed", "true");
  });
});
