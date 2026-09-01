import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { SupportPrompt } from "./SupportPrompt";
import * as support from "../../utils/supportPrompt";

vi.mock("../../utils/supportPrompt", async (load) => ({
  ...(await load<typeof import("../../utils/supportPrompt")>()),
  markStarDone: vi.fn(),
  shareEncounty: vi.fn(),
}));

describe("SupportPrompt", () => {
  it("marks either star action done and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SupportPrompt variant="star" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Hab ich schon" }));
    expect(support.markStarDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shares, reports a copied link, and closes", async () => {
    const user = userEvent.setup();
    vi.mocked(support.shareEncounty).mockResolvedValue("copied");
    const onClose = vi.fn();
    render(<SupportPrompt variant="recommend" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /weiterempfehlen/i }));
    expect(support.shareEncounty).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
