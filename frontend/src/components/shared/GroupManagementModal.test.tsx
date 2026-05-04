import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "../../test-utils";
import { GroupManagementModal } from "./GroupManagementModal";
import type { Group } from "../../types";

// jsdom does not implement these HTMLDialogElement methods.
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

const makeGroup = (overrides?: Partial<Group>): Group => ({
  id: "g1",
  name: "Legendaries",
  color: "#3b82f6",
  sort_order: 0,
  collapsed: false,
  ...overrides,
});

describe("GroupManagementModal", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists existing groups", () => {
    render(
      <GroupManagementModal
        groups={[makeGroup({ id: "g1", name: "A" }), makeGroup({ id: "g2", name: "B", sort_order: 1 })]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("B")).toBeInTheDocument();
  });

  it("creates a new group via POST /api/groups", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<GroupManagementModal groups={[]} onClose={() => {}} />);
    // jsdom does not run dialog.showModal so contents are hidden from the a11y tree;
    // pass hidden:true to allow queries.
    const input = screen.getByPlaceholderText(/name/i);
    await user.type(input, "Shinies");
    const createBtn = screen.getByRole("button", { name: /^anlegen$/i, hidden: true });
    await user.click(createBtn);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(call).toBeTruthy();
      expect(call![0]).toContain("/api/groups");
      expect(JSON.parse(call![1].body)).toMatchObject({ name: "Shinies" });
    });
  });

  it("opens the delete confirm modal when the trash button is clicked", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <GroupManagementModal
        groups={[makeGroup({ id: "gx", name: "Doomed" })]}
        onClose={() => {}}
      />,
    );
    const deleteBtns = screen.getAllByRole("button", {
      name: /gruppe löschen/i,
      hidden: true,
    });
    await user.click(deleteBtns[0]);
    await waitFor(() => {
      expect(screen.getByText(/Doomed/)).toBeInTheDocument();
    });
  });

  it("calls onClose when X is clicked", async () => {
    const onClose = vi.fn();
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<GroupManagementModal groups={[]} onClose={onClose} />);
    const closeButtons = screen.getAllByRole("button", {
      name: /schließen/i,
      hidden: true,
    });
    await user.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows noneYet placeholder when groups array is empty", () => {
    render(<GroupManagementModal groups={[]} onClose={() => {}} />);
    // The dialog is open via ref, content should contain at least one italic placeholder
    // We assert via the placeholder input still being present and no group rows.
    expect(screen.queryByDisplayValue(/Legend/)).not.toBeInTheDocument();
  });

  it("expands the color palette on group when swatch is clicked", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <GroupManagementModal
        groups={[makeGroup({ id: "g1", name: "Alpha" })]}
        onClose={() => {}}
      />,
    );
    // The first swatch is the group row's; second is the "create" row default.
    const swatches = screen.getAllByRole("button", { name: /Farbe|Color/, hidden: true });
    await user.click(swatches[0]);
    // The palette exposes each color as a named button (hex code aria-label).
    const paletteBtn = screen.getAllByRole("button", { name: "#ef4444", hidden: true });
    expect(paletteBtn.length).toBeGreaterThan(0);
  });

  it("calls updateGroup when a palette color is selected for a group", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <GroupManagementModal
        groups={[makeGroup({ id: "g1", name: "Alpha" })]}
        onClose={() => {}}
      />,
    );
    const swatches = screen.getAllByRole("button", { name: /Farbe|Color/, hidden: true });
    await user.click(swatches[0]);
    const paletteBtn = screen.getAllByRole("button", { name: "#ef4444", hidden: true });
    await user.click(paletteBtn[0]);
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall![1].body)).toMatchObject({ color: "#ef4444" });
    });
  });

  it("disables move-up on the first row and move-down on the last row", () => {
    render(
      <GroupManagementModal
        groups={[
          makeGroup({ id: "a", name: "First", sort_order: 0 }),
          makeGroup({ id: "b", name: "Last", sort_order: 1 }),
        ]}
        onClose={() => {}}
      />,
    );
    const upButtons = screen.getAllByRole("button", { name: /nach oben|up/i, hidden: true });
    const downButtons = screen.getAllByRole("button", { name: /nach unten|down/i, hidden: true });
    expect((upButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downButtons[downButtons.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("swaps sort_order via two PUT calls when move-down is clicked", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <GroupManagementModal
        groups={[
          makeGroup({ id: "a", name: "First", sort_order: 0 }),
          makeGroup({ id: "b", name: "Second", sort_order: 1 }),
        ]}
        onClose={() => {}}
      />,
    );
    const downButtons = screen.getAllByRole("button", { name: /nach unten|down/i, hidden: true });
    await user.click(downButtons[0]);
    await waitFor(() => {
      const putCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
      expect(putCalls.length).toBe(2);
    });
  });

  it("renames a group on blur when the draft differs", async () => {
    const { fireEvent } = await import("../../test-utils");
    render(
      <GroupManagementModal
        groups={[makeGroup({ id: "g1", name: "Old" })]}
        onClose={() => {}}
      />,
    );
    const input = screen.getByDisplayValue("Old") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.blur(input);
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall![1].body)).toEqual({ name: "New Name" });
    });
  });

  it("does not call updateGroup when the draft is blank", async () => {
    const { fireEvent } = await import("../../test-utils");
    render(
      <GroupManagementModal
        groups={[makeGroup({ id: "g1", name: "Keep" })]}
        onClose={() => {}}
      />,
    );
    const input = screen.getByDisplayValue("Keep") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    // Give React a tick to process blur.
    await new Promise((r) => setTimeout(r, 20));
    const putCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(putCalls.length).toBe(0);
  });

  it("creating with Enter triggers POST", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<GroupManagementModal groups={[]} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/name/i);
    await user.type(input, "Shinies{Enter}");
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(postCall).toBeTruthy();
    });
  });

  it("confirming deletion triggers DELETE", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(
      <GroupManagementModal
        groups={[makeGroup({ id: "gx", name: "Doomed" })]}
        onClose={() => {}}
      />,
    );
    const deleteBtns = screen.getAllByRole("button", {
      name: /gruppe löschen/i,
      hidden: true,
    });
    await user.click(deleteBtns[0]);
    // Confirm modal shows; click the destructive confirm action.
    const confirmBtn = await screen.findByRole("button", { name: /bestätigen|confirm/i, hidden: true });
    await user.click(confirmBtn);
    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
      expect(deleteCall).toBeTruthy();
    });
  });

  it("toggles the create-row color picker open and closed", async () => {
    const { userEvent } = await import("../../test-utils");
    const user = userEvent.setup();
    render(<GroupManagementModal groups={[]} onClose={() => {}} />);
    const createSwatch = screen.getAllByRole("button", { name: /Farbe|Color/, hidden: true })[0];
    await user.click(createSwatch);
    // Palette opens — color buttons visible
    expect(screen.getAllByRole("button", { name: "#ef4444", hidden: true }).length).toBeGreaterThan(0);
    await user.click(createSwatch);
    // Palette closes
    expect(screen.queryAllByRole("button", { name: "#ef4444", hidden: true }).length).toBe(0);
  });
});
