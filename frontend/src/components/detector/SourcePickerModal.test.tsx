import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { SourcePickerModal } from "./SourcePickerModal";

// Mock HTMLDialogElement methods since jsdom does not implement them
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

describe("SourcePickerModal", () => {
  it("renders modal with source picker UI (camera mode)", () => {
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Dialog is rendered but not open (showModal is mocked), query with hidden option
    expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
    // Title should be visible
    expect(screen.getByText("Quelle auswählen")).toBeInTheDocument();
  });

  it("calls onClose when cancel button clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );

    // "Abbrechen" is the German cancel button text
    await user.click(screen.getByText("Abbrechen"));
    expect(onClose).toHaveBeenCalled();
  });

  it("handles empty device list gracefully", async () => {
    // Stub navigator.mediaDevices to return empty list
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
      configurable: true,
    });

    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // The dialog should render without crashing
    expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();

    // Restore
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  it("shows select button disabled when no source selected", () => {
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // "Auswählen" is the German select button text
    const selectBtn = screen.getByText("Auswählen");
    expect(selectBtn).toBeDisabled();
  });
});
