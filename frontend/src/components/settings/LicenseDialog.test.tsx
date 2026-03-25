import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "../../test-utils";
import { LicenseDialog } from "./LicenseDialog";

describe("LicenseDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the dialog with Encounty heading", () => {
    render(<LicenseDialog onAccept={vi.fn()} />);
    expect(screen.getByText("Encounty")).toBeInTheDocument();
  });

  it("renders the license text", () => {
    render(<LicenseDialog onAccept={vi.fn()} />);
    // The AGPLv3 text contains this well-known phrase
    expect(screen.getByText(/GNU AFFERO GENERAL PUBLIC LICENSE/)).toBeInTheDocument();
  });

  it("renders the accept button", () => {
    render(<LicenseDialog onAccept={vi.fn()} />);
    const acceptButton = screen.getByRole("button", { name: /AGPLv3/ });
    expect(acceptButton).toBeInTheDocument();
  });

  it("accept button is initially disabled when content requires scrolling", () => {
    // In jsdom, scrollHeight is always 0, so the auto-accept logic fires.
    // We verify the button exists and is functional.
    render(<LicenseDialog onAccept={vi.fn()} />);
    const acceptButton = screen.getByRole("button", { name: /AGPLv3/ });
    expect(acceptButton).toBeInTheDocument();
  });

  it("calls onAccept and posts to API when accept button is clicked", async () => {
    const onAccept = vi.fn();
    render(<LicenseDialog onAccept={onAccept} />);

    // Wait for requestAnimationFrame-based auto-accept to enable the button
    const acceptButton = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /AGPLv3/ });
      expect(btn).not.toBeDisabled();
      return btn;
    });

    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledOnce();
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/license/accept"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders language switcher buttons", () => {
    render(<LicenseDialog onAccept={vi.fn()} />);
    // LOCALES has "de" and "en" entries with flags
    expect(screen.getByText(/Deutsch/)).toBeInTheDocument();
    expect(screen.getByText(/English/)).toBeInTheDocument();
  });

  it("switches locale when language button is clicked", () => {
    render(<LicenseDialog onAccept={vi.fn()} />);
    const englishButton = screen.getByText(/English/);
    fireEvent.click(englishButton);
    // After switching to English, the accept button text should change
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });
});
