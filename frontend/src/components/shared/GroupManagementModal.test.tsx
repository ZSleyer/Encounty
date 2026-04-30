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
});
