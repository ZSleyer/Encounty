import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { SourcePickerModal } from "./SourcePickerModal";

// Mock HTMLDialogElement methods since jsdom does not implement them
// Mock HTMLVideoElement.play since jsdom returns undefined instead of a Promise
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
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

  it("renders title heading in the dialog", () => {
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Dialog is not truly open (showModal is mocked), use hidden option
    expect(screen.getByRole("heading", { name: "Quelle auswählen", hidden: true })).toBeInTheDocument();
  });

  it("shows close X button in header", () => {
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Dialog content is hidden; query with hidden option
    const buttons = screen.getAllByRole("button", { hidden: true });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onClose when X header button clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    // Dialog content is hidden; query with hidden option
    const buttons = screen.getAllByRole("button", { hidden: true });
    // First button in the header is the X close
    await user.click(buttons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders screens and windows tabs for display source type", () => {
    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Bildschirme")).toBeInTheDocument();
    expect(screen.getByText("Fenster")).toBeInTheDocument();
  });

  it("does not show screen/window tabs for camera source type", () => {
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Bildschirme")).not.toBeInTheDocument();
    expect(screen.queryByText("Fenster")).not.toBeInTheDocument();
  });

  it("shows loading spinner initially for camera mode", () => {
    // Stub mediaDevices so it never resolves
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        enumerateDevices: vi.fn(() => new Promise(() => {})),
        getUserMedia: vi.fn(() => new Promise(() => {})),
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
    // Should show refreshing text
    expect(screen.getByText("Aktualisiere…")).toBeInTheDocument();

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  it("shows no sources message when camera list is empty", async () => {
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

    const noSources = await screen.findByText("Keine Quellen gefunden");
    expect(noSources).toBeInTheDocument();

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  it("select button remains disabled until a source is chosen", () => {
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const selectBtn = screen.getByText("Auswählen");
    // Should have disabled-like styling (opacity-60 class or disabled attribute)
    expect(selectBtn.className).toContain("cursor-not-allowed");
  });

  it("switches tabs in display mode", async () => {
    const user = userEvent.setup();
    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Click on "Fenster" tab
    const windowsTab = screen.getByText("Fenster");
    await user.click(windowsTab);
    // The windows tab should now be active (has accent-blue bg class)
    expect(windowsTab.closest("button")?.className).toContain("bg-accent-blue");
  });

  it("renders footer with cancel and select buttons", () => {
    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Abbrechen")).toBeInTheDocument();
    expect(screen.getByText("Auswählen")).toBeInTheDocument();
  });

  // --- Screen/window source rendering with Electron API ---

  it("renders screen sources with thumbnails in display mode", async () => {
    // Set up Electron API mock with capture sources
    const mockSources: CaptureSource[] = [
      { id: "screen:0", name: "Screen 1", thumbnail: "data:image/png;base64,abc", display_id: "0", appIcon: null },
      { id: "screen:1", name: "Screen 2", thumbnail: "data:image/png;base64,def", display_id: "1", appIcon: null },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Wait for sources to load
    const screen1 = await screen.findByText("Screen 1");
    expect(screen1).toBeInTheDocument();
    expect(screen.getByText("Screen 2")).toBeInTheDocument();

    // Thumbnails are inside a dialog (hidden in jsdom), query with hidden option
    const images = screen.getAllByRole("img", { hidden: true });
    expect(images.length).toBeGreaterThanOrEqual(2);

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  it("renders window sources when windows tab is active", async () => {
    const user = userEvent.setup();
    const mockSources: CaptureSource[] = [
      { id: "screen:0", name: "Screen 1", thumbnail: "data:image/png;base64,abc", display_id: "0", appIcon: null },
      { id: "window:123", name: "Firefox", thumbnail: "data:image/png;base64,ghi", display_id: "", appIcon: "data:image/png;base64,icon" },
      { id: "window:456", name: "VS Code", thumbnail: "data:image/png;base64,jkl", display_id: "", appIcon: null },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Wait for sources to load, switch to windows tab
    await screen.findByText("Screen 1");
    await user.click(screen.getByText("Fenster"));

    // Windows should now be visible
    expect(screen.getByText("Firefox")).toBeInTheDocument();
    expect(screen.getByText("VS Code")).toBeInTheDocument();
    // Screen should not be visible
    expect(screen.queryByText("Screen 1")).not.toBeInTheDocument();

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  it("renders app icon for window sources that have one", async () => {
    const user = userEvent.setup();
    const mockSources: CaptureSource[] = [
      { id: "window:123", name: "Firefox", thumbnail: "data:image/png;base64,ghi", display_id: "", appIcon: "data:image/png;base64,icon" },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Switch to windows tab
    await screen.findByText("Fenster");
    await user.click(screen.getByText("Fenster"));

    await screen.findByText("Firefox");
    // App icon is rendered inside hidden dialog
    const images = screen.getAllByRole("img", { hidden: true });
    expect(images.length).toBeGreaterThanOrEqual(1);

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  // --- Source selection and highlight ---

  it("highlights a source when clicked and enables select button", async () => {
    const user = userEvent.setup();
    const mockSources: CaptureSource[] = [
      { id: "screen:0", name: "Screen 1", thumbnail: "data:image/png;base64,abc", display_id: "0", appIcon: null },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByText("Screen 1");

    // Click the source button
    const sourceButton = screen.getByText("Screen 1").closest("button")!;
    await user.click(sourceButton);

    // Source should be highlighted (has accent-blue border)
    expect(sourceButton.className).toContain("border-accent-blue");

    // Select button should now be enabled
    const selectBtn = screen.getByText("Auswählen");
    expect(selectBtn.className).not.toContain("cursor-not-allowed");

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  it("calls onSelect when select button is clicked after choosing a source", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const mockSources: CaptureSource[] = [
      { id: "screen:0", name: "Screen 1", thumbnail: "data:image/png;base64,abc", display_id: "0", appIcon: null },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    await screen.findByText("Screen 1");
    const sourceButton = screen.getByText("Screen 1").closest("button")!;
    await user.click(sourceButton);

    const selectBtn = screen.getByText("Auswählen");
    await user.click(selectBtn);

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "screen",
        sourceId: "screen:0",
        label: "Screen 1",
      }),
    );

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  // --- Tab switching resets selection ---

  it("resets selection when switching tabs", async () => {
    const user = userEvent.setup();
    const mockSources: CaptureSource[] = [
      { id: "screen:0", name: "Screen 1", thumbnail: "data:image/png;base64,abc", display_id: "0", appIcon: null },
      { id: "window:123", name: "Firefox", thumbnail: "data:image/png;base64,ghi", display_id: "", appIcon: null },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Select a screen
    await screen.findByText("Screen 1");
    const sourceButton = screen.getByText("Screen 1").closest("button")!;
    await user.click(sourceButton);

    // Switch to windows tab
    await user.click(screen.getByText("Fenster"));

    // Select button should be disabled again (selection reset)
    const selectBtn = screen.getByText("Auswählen");
    expect(selectBtn.className).toContain("cursor-not-allowed");

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  // --- Camera rendering ---

  /** Returns a fresh mock MediaStream for camera tests. */
  const createMockStream = () => ({
    getTracks: () => [{ stop: vi.fn() }],
  }) as unknown as MediaStream;

  it("renders camera devices with live preview", async () => {
    const originalMediaDevices = navigator.mediaDevices;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: "videoinput", deviceId: "cam-1", label: "Built-in Webcam" },
          { kind: "videoinput", deviceId: "cam-2", label: "Elgato Cam Link 4K" },
        ]),
        getUserMedia: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
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

    // Wait for camera labels to render (inside hidden dialog)
    const webcam = await screen.findByText("Built-in Webcam", {}, { timeout: 3000 });
    expect(webcam).toBeInTheDocument();
    const elgato = screen.getByText("Elgato Cam Link 4K");
    expect(elgato).toBeInTheDocument();

    // Capture card badge should appear for Elgato
    expect(screen.getByText("Capture Card")).toBeInTheDocument();

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  it("selects camera source when clicked and calls onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const originalMediaDevices = navigator.mediaDevices;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: "videoinput", deviceId: "cam-1", label: "Built-in Webcam" },
        ]),
        getUserMedia: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
      },
      configurable: true,
    });

    render(
      <SourcePickerModal
        sourceType="browser_camera"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    // Wait for camera to load (inside hidden dialog)
    const webcamLabel = await screen.findByText("Built-in Webcam", {}, { timeout: 3000 });
    const cameraButton = webcamLabel.closest("button")!;
    await user.click(cameraButton);

    // Camera should be highlighted
    expect(cameraButton.className).toContain("border-accent-blue");

    // Click select
    const selectBtn = screen.getByText("Auswählen");
    await user.click(selectBtn);

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "camera",
        sourceId: "cam-1",
        label: "Built-in Webcam",
      }),
    );

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  // --- Electron getCaptureSources failure ---

  it("handles getCaptureSources failure gracefully", async () => {
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockRejectedValue(new Error("Failed")),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Should show "no sources" message after failed fetch
    const noSources = await screen.findByText("Keine Quellen gefunden");
    expect(noSources).toBeInTheDocument();

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  // --- getUserMedia permission failure ---

  it("handles camera permission denial gracefully", async () => {
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")),
        enumerateDevices: vi.fn().mockResolvedValue([]),
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

    // Should render without crashing
    expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  // --- No sources message for display mode ---

  it("shows loading spinner when electronAPI is not available for display mode", () => {
    // Ensure no electronAPI
    const prev = globalThis.electronAPI;
    delete (globalThis as Record<string, unknown>).electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // When isElectron is false, fetchSources returns early without setting loading to false,
    // so the spinner stays visible
    expect(screen.getByText("Aktualisiere…")).toBeInTheDocument();

    if (prev) globalThis.electronAPI = prev;
  });

  // --- Double click for immediate selection ---

  it("selects source immediately on double click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const mockSources: CaptureSource[] = [
      { id: "screen:0", name: "Screen 1", thumbnail: "data:image/png;base64,abc", display_id: "0", appIcon: null },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    await screen.findByText("Screen 1");
    const sourceButton = screen.getByText("Screen 1").closest("button")!;
    await user.dblClick(sourceButton);

    // Double-click triggers onSelect immediately (via setTimeout)
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "screen",
          sourceId: "screen:0",
        }),
      );
    });

    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  // --- Screens tab is active by default in display mode ---

  it("screens tab is active by default in display mode", async () => {
    const mockSources: CaptureSource[] = [
      { id: "screen:0", name: "Screen 1", thumbnail: "data:image/png;base64,abc", display_id: "0", appIcon: null },
    ];
    globalThis.electronAPI = {
      getCaptureSources: vi.fn().mockResolvedValue(mockSources),
    } as unknown as typeof globalThis.electronAPI;

    render(
      <SourcePickerModal
        sourceType="browser_display"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Screens tab should be active (has bg-accent-blue)
    const screensTab = screen.getByText("Bildschirme").closest("button")!;
    expect(screensTab.className).toContain("bg-accent-blue");

    delete (globalThis as Record<string, unknown>).electronAPI;
  });
});
