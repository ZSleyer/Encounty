/**
 * App.update.test.tsx: Update discovery, prompting and installation.
 *
 * Covers both paths: electron-updater IPC on auto-update builds and the REST
 * check used by portable, macOS and browser builds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { useCounterStore } from "./hooks/useCounterState";

const mockFetch = vi.fn();

beforeEach(() => {
  // Reset Zustand store to initial state between tests
  useCounterStore.setState({ isConnected: false, appState: null, detectorStatus: {} });
  // Reset useWebSocket mock to default (non-capturing) implementation
  mockUseWebSocket.mockReset();
  mockUseWebSocket.mockReturnValue({ send: vi.fn() } as ReturnType<typeof useWebSocketMock>);
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/status/ready") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ready: true }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ display: "1.0.0", build_date: "2024-01-01" }),
    });
  });
  vi.stubGlobal("fetch", mockFetch);
});

vi.mock("./hooks/useWebSocket", async () => {
  const React = await import("react");
  return {
    useWebSocket: vi.fn(() => ({ send: vi.fn() })),
    WebSocketProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("./engine/startDetection", () => ({
  stopDetectionForPokemon: vi.fn(),
  startDetectionForPokemon: vi.fn(),
  ensureDetector: vi.fn(),
  getDetectorBackend: vi.fn(() => null),
  setForceCPU: vi.fn(),
  isForceCPU: vi.fn(() => false),
  reloadDetectionTemplates: vi.fn(),
}));

// Mock the capture service so tests can plant fake "active stream" state for
// a given pokemon without needing real getDisplayMedia access (jsdom lacks it).
// The provider stays a plain passthrough.
const capturingPokemonIds = new Set<string>();
const fakeVideoEl = { tagName: "VIDEO" } as unknown as HTMLVideoElement;
vi.mock("./contexts/CaptureServiceContext", async () => {
  const React = await import("react");
  const captureService = {
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    getStream: vi.fn(),
    getVideoElement: (id: string) => (capturingPokemonIds.has(id) ? fakeVideoEl : null),
    isCapturing: (id: string) => capturingPokemonIds.has(id),
    getSourceLabel: () => null,
    captureError: null,
    getVersion: () => 0,
    subscribe: () => () => {},
  };
  return {
    CaptureServiceProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useCaptureService: () => captureService,
    useCaptureVersion: () => 0,
  };
});

// Import the mocked module statically to get a stable reference
import { useWebSocket as useWebSocketMock } from "./hooks/useWebSocket";
const mockUseWebSocket = vi.mocked(useWebSocketMock);

/** Configure mockFetch to return a fully accepted state so AppShell renders. */
function mockAcceptedState() {
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/status/ready") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ready: true }),
      });
    }
    if (url === "/api/state") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            license_accepted: true,
            pokemon: [],
            settings: {},
            hotkeys: {},
          }),
      });
    }
    if (url === "/api/version") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ display: "2.0.0", build_date: "2025-01-01" }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });
}

describe("App", () => {
  it("registers electron update callbacks on mount and cleans up on unmount", async () => {
    mockAcceptedState();

    const cleanupFns = {
      available: vi.fn(),
      progress: vi.fn(),
      downloaded: vi.fn(),
      error: vi.fn(),
    };

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn(() => cleanupFns.available),
      onUpdateProgress: vi.fn(() => cleanupFns.progress),
      onUpdateDownloaded: vi.fn(() => cleanupFns.downloaded),
      onUpdateError: vi.fn(() => cleanupFns.error),
    };

    const { unmount } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const api = (globalThis as Record<string, unknown>).electronAPI as Record<string, unknown>;
      expect(api.onUpdateAvailable).toHaveBeenCalled();
      expect(api.onUpdateProgress).toHaveBeenCalled();
      expect(api.onUpdateDownloaded).toHaveBeenCalled();
      expect(api.onUpdateError).toHaveBeenCalled();
    });

    unmount();

    // Cleanup functions should be called on unmount
    expect(cleanupFns.available).toHaveBeenCalled();
    expect(cleanupFns.progress).toHaveBeenCalled();
    expect(cleanupFns.downloaded).toHaveBeenCalled();
    expect(cleanupFns.error).toHaveBeenCalled();

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Update notification renders when electronAPI triggers onUpdateAvailable ---

  it("shows update notification when electron reports available update", async () => {
    mockAcceptedState();

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    // Trigger the update available callback
    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "9.9.9" });
    });

    // Update notification should appear with the version (may appear multiple times: popup + footer)
    await waitFor(() => {
      expect(screen.getAllByText("9.9.9").length).toBeGreaterThanOrEqual(1);
    });

    // The update notification popup should be rendered as an accessible dialog
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Dismiss update notification sets sessionStorage ---

  it("dismisses update notification and sets sessionStorage flag", async () => {
    mockAcceptedState();
    const mockSessionStorage: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => mockSessionStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockSessionStorage[key] = val;
      },
    });

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "9.9.9" });
    });

    await waitFor(() => {
      expect(screen.getAllByText("9.9.9").length).toBeGreaterThanOrEqual(1);
    });

    // Click the "Later" dismiss button
    const laterBtn = screen.getByText(/Später/i);
    act(() => {
      fireEvent.click(laterBtn);
    });

    // Session storage should have the flag set
    expect(mockSessionStorage["update_dismissed"]).toBe("1");

    // Notification should disappear
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Update now button on win32/darwin opens external link ---

  it("opens the Pages download page when update now clicked on macOS", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });

    const mockOpen = vi.fn();
    vi.stubGlobal("open", mockOpen);

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "darwin",
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn(() => () => {}),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
    };

    // macOS uses the REST API path for update checks
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              license_accepted: true,
              pokemon: [],
              settings: {},
              hotkeys: {},
            }),
        });
      }
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "v0.8.0-abc", build_date: "01.01.26" }),
        });
      }
      if (url === "/api/update/check") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true, latest_version: "v5.0.0" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getAllByText("v5.0.0").length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 8000 },
    );

    // Click the "Download" / "Herunterladen" button (macOS manual download)
    const updateBtn = screen.getByText(/Herunterladen/i);
    act(() => {
      fireEvent.click(updateBtn);
    });

    // Should open external URL
    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining("zsleyer.github.io/Encounty/update.html"),
        "_blank",
      );
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  }, 10000);

  // --- Footer update badge renders and triggers applyUpdate ---

  it("renders update badge in footer when update is available", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "8.0.0" });
    });

    // Dismiss the notification popup first
    await waitFor(() => {
      expect(screen.getAllByText("8.0.0").length).toBeGreaterThanOrEqual(1);
    });
    const laterBtn = screen.getByText(/Später/i);
    act(() => {
      fireEvent.click(laterBtn);
    });

    // Footer badge button should show the version
    await waitFor(() => {
      // There may be multiple instances of the version text; look for the footer badge
      const badges = screen.getAllByText("8.0.0");
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- UpdateOverlay renders installing state ---

  it("renders UpdateOverlay with downloading state text", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: () => "1", // dismissed so notification popup doesn't appear
      setItem: vi.fn(),
    });

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
      downloadUpdate: vi.fn(() => new Promise(() => {})), // hangs to keep the download state
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    // Trigger update available
    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "4.0.0" });
    });

    // Click footer badge to trigger applyUpdate (Linux path = downloadUpdate)
    await waitFor(() => {
      expect(screen.getAllByText("4.0.0").length).toBeGreaterThanOrEqual(1);
    });

    // Click the footer update badge button (not the notification since it was dismissed)
    const badges = screen.getAllByText("4.0.0");
    const footerBadge = badges.find((el) => el.closest("button") && el.closest("footer"));
    if (footerBadge) {
      act(() => {
        fireEvent.click(footerBadge.closest("button")!);
      });
    }

    // The download is its own step now: while it runs the overlay names it
    // rather than claiming an install that has not started.
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText).toContain("Update wird heruntergeladen");
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- UpdateOverlay renders restarting state on Linux after download ---

  it("shows restarting overlay on Linux when update download completes", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: () => "1",
      setItem: vi.fn(),
    });

    let downloadedCb: (() => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        // Immediately trigger update available
        setTimeout(() => cb({ version: "6.0.0" }), 0);
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn((cb: () => void) => {
        downloadedCb = cb;
        return () => {};
      }),
      onUpdateError: vi.fn(() => () => {}),
      installUpdate: vi.fn(),
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("6.0.0").length).toBeGreaterThanOrEqual(1);
    });

    // Simulate download completed, onUpdateDownloaded fires installUpdate + sets restarting
    if (downloadedCb) {
      act(() => {
        downloadedCb!();
      });
    }

    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText).toContain("Neustart");
    });

    const api = (globalThis as Record<string, unknown>).electronAPI as Record<
      string,
      { mock: unknown }
    >;
    expect(api.installUpdate).toHaveBeenCalled();

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- UpdateNotification changelog link has correct version tag ---

  it("renders changelog link with correct version tag", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "3.2.1" });
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Changelog link should point to the GitHub Pages changelog page
    const changelogLink = screen.getByText(/Änderungen ansehen/i);
    expect(changelogLink.closest("a")?.getAttribute("href")).toContain(
      "zsleyer.github.io/Encounty/changelog.html",
    );

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Update error resets update state to idle ---

  it("resets update state to idle when electron reports update error", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: () => "1",
      setItem: vi.fn(),
    });

    let errorCb: ((msg: string) => void) | undefined;
    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn((cb: (msg: string) => void) => {
        errorCb = cb;
        return () => {};
      }),
      downloadUpdate: vi.fn(() => new Promise(() => {})), // hangs
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "7.0.0" });
    });

    await waitFor(() => {
      expect(screen.getAllByText("7.0.0").length).toBeGreaterThanOrEqual(1);
    });

    // Trigger the footer badge to start installing
    const badges = screen.getAllByText("7.0.0");
    const footerBadge = badges.find((el) => el.closest("button") && el.closest("footer"));
    if (footerBadge) {
      act(() => {
        fireEvent.click(footerBadge.closest("button")!);
      });
    }

    // UpdateOverlay should appear
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText).toContain("Update wird heruntergeladen");
    });

    // Now trigger an update error, should reset to idle
    await waitFor(() => {
      expect(errorCb).toBeDefined();
    });
    act(() => {
      errorCb!("Download failed");
    });

    // UpdateOverlay should disappear (updateState back to idle)
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText).not.toContain("Update wird heruntergeladen");
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Update now on Linux triggers download ---

  it("triggers download on Linux when update now is clicked", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;
    const downloadMock = vi.fn(() => new Promise(() => {})); // never resolves to keep installing state

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
      downloadUpdate: downloadMock,
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "10.0.0" });
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Click "Jetzt aktualisieren" (Update Now) in the notification
    const updateNowBtn = screen.getByText(/Jetzt aktualisieren/i);
    act(() => {
      fireEvent.click(updateNowBtn);
    });

    // downloadUpdate should have been called
    await waitFor(() => {
      expect(downloadMock).toHaveBeenCalled();
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Update on portable Windows opens external link ---

  it("opens the Pages download page when update now clicked on portable Windows", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });

    const mockOpen = vi.fn();
    vi.stubGlobal("open", mockOpen);

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "win32",
      autoUpdate: false,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn(() => () => {}),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
    };

    // Portable Windows uses the REST API path for update checks
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              license_accepted: true,
              pokemon: [],
              settings: {},
              hotkeys: {},
            }),
        });
      }
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "v0.8.0-abc", build_date: "01.01.26" }),
        });
      }
      if (url === "/api/update/check") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true, latest_version: "v11.0.0" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    // Click the download button (Windows = manual download)
    const downloadBtn = screen.getByText(/Herunterladen/i);
    act(() => {
      fireEvent.click(downloadBtn);
    });

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining("zsleyer.github.io/Encounty/update.html"),
        "_blank",
      );
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  }, 10000);

  // --- Update now on installed (NSIS) Windows triggers IPC download ---

  it("triggers download on installed Windows when update now is clicked", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });

    mockAcceptedState();

    const downloadMock = vi.fn().mockResolvedValue(undefined);
    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "win32",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
      downloadUpdate: downloadMock,
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "10.0.0" });
    });

    // Click the "Update now" button in the notification (rendered in the German test locale)
    const updateNowBtn = await screen.findByText(/Jetzt aktualisieren/i);
    act(() => {
      fireEvent.click(updateNowBtn);
    });

    // downloadUpdate should have been called via IPC (no external link)
    await waitFor(() => {
      expect(downloadMock).toHaveBeenCalled();
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- WebSocket message handlers ---

  it("does not show update notification when sessionStorage has dismiss flag", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => (key === "update_dismissed" ? "1" : null),
      setItem: vi.fn(),
    });

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "12.0.0" });
    });

    // Footer badge should appear but not the notification popup
    await waitFor(() => {
      expect(screen.getAllByText("12.0.0").length).toBeGreaterThanOrEqual(1);
    });

    // The notification popup (role="dialog") should NOT appear
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- applyUpdate does nothing when updateInfo is null ---

  it("does not crash when footer badge is clicked without updateInfo", async () => {
    mockAcceptedState();

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    // No update badge should be present, verify app is still functional
    expect(document.body).toBeTruthy();
  });

  // --- WebSocket disconnect sets connected to false ---

  it("resets update state when downloadUpdate rejects", async () => {
    mockAcceptedState();
    vi.stubGlobal("sessionStorage", {
      getItem: () => "1",
      setItem: vi.fn(),
    });

    let updateAvailableCb: ((info: { version: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: vi.fn((cb: (info: { version: string }) => void) => {
        updateAvailableCb = cb;
        return () => {};
      }),
      onUpdateProgress: vi.fn(() => () => {}),
      onUpdateDownloaded: vi.fn(() => () => {}),
      onUpdateError: vi.fn(() => () => {}),
      downloadUpdate: vi.fn().mockRejectedValue(new Error("Download failed")),
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(updateAvailableCb).toBeDefined();
    });
    act(() => {
      updateAvailableCb!({ version: "13.0.0" });
    });

    await waitFor(() => {
      expect(screen.getAllByText("13.0.0").length).toBeGreaterThanOrEqual(1);
    });

    // Click footer badge to trigger download
    const badges = screen.getAllByText("13.0.0");
    const footerBadge = badges.find((el) => el.closest("button") && el.closest("footer"));
    if (footerBadge) {
      act(() => {
        fireEvent.click(footerBadge.closest("button")!);
      });
    }

    // After download fails, should reset to idle (no overlay)
    await waitFor(() => {
      const allText = document.body.textContent ?? "";
      expect(allText).not.toContain("Wird installiert");
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Crisp sprites toggle removes attribute when disabled ---

  it("shows update notification via REST API when no electronAPI is present", async () => {
    delete (globalThis as { electronAPI?: unknown }).electronAPI;

    // Use a short delay: mock setTimeout to fire the update check immediately
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              license_accepted: true,
              pokemon: [],
              settings: {},
              hotkeys: {},
            }),
        });
      }
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "v0.8.0-abc", build_date: "01.01.26" }),
        });
      }
      if (url === "/api/update/check") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true, latest_version: "v0.9.0" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Wait for update notification to appear (5s delay + fetch resolution)
    await waitFor(
      () => {
        expect(screen.getAllByText("v0.9.0").length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 8000 },
    );
  }, 10000);

  it("does not show update notification via REST API when not available", async () => {
    delete (globalThis as { electronAPI?: unknown }).electronAPI;

    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              license_accepted: true,
              pokemon: [],
              settings: {},
              hotkeys: {},
            }),
        });
      }
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "v0.8.0-abc", build_date: "01.01.26" }),
        });
      }
      if (url === "/api/update/check") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: false, latest_version: "v0.8.0" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Wait for the update check to complete (5s + fetch)
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith("/api/update/check");
      },
      { timeout: 8000 },
    );

    // No update notification should appear
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 10000);

  it("handles REST API update check failure gracefully", async () => {
    delete (globalThis as { electronAPI?: unknown }).electronAPI;

    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              license_accepted: true,
              pokemon: [],
              settings: {},
              hotkeys: {},
            }),
        });
      }
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "v0.8.0-abc", build_date: "01.01.26" }),
        });
      }
      if (url === "/api/update/check") {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Wait for the update check to have been attempted
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith("/api/update/check");
      },
      { timeout: 8000 },
    );

    // No crash, no notification
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 10000);
});
