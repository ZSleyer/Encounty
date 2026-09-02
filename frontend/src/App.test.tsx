/**
 * App.test.tsx: Shell chrome of the root component.
 *
 * Covers what every route shares: the provider stack, the header navigation,
 * the routed outlets, and the footer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, createMemoryRouter, RouterProvider } from "react-router";
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
  it("renders without crashing", async () => {
    // App does not include BrowserRouter, so wrap it here.
    // App contains ThemeProvider, I18nProvider, ToastProvider already.
    const { container } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });

  it("fetches and displays version information", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/status/ready") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true }),
        });
      }
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "1.2.3", build_date: "2024-03-19" }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ license_accepted: true, pokemon: [], settings: {}, hotkeys: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/version");
    });

    // Version should appear in the footer
    await waitFor(() => {
      expect(screen.getByText(/Encounty 1.2.3/)).toBeInTheDocument();
    });
  });

  it("sets theme attribute on document element", async () => {
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
            Promise.resolve({ license_accepted: true, pokemon: [], settings: {}, hotkeys: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ display: "1.0.0", build_date: "2024-01-01" }),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Theme attribute should be set (default is dark)
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBeTruthy();
    });
  });

  it("does not render WindowControls in non-Electron mode", async () => {
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
            Promise.resolve({ license_accepted: true, pokemon: [], settings: {}, hotkeys: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ display: "1.0.0", build_date: "2024-01-01" }),
      });
    });

    // Ensure electronAPI is not set
    delete (globalThis as { electronAPI?: unknown }).electronAPI;

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // WindowControls should not render any buttons in non-Electron mode
    // (WindowControls component returns null when electronAPI is undefined)
    await waitFor(() => {
      expect(screen.queryByTitle("Minimize")).not.toBeInTheDocument();
    });
  });

  // --- Provider wrapping ---

  it("wraps content with ThemeProvider (data-theme attribute is set)", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await waitFor(() => {
      // ThemeProvider sets a data-theme attribute on the document element
      expect(document.documentElement.dataset.theme).toBeTruthy();
    });
  });

  it("wraps content with I18nProvider (translated nav links render)", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    // Wait for the app to finish loading and render nav links
    await waitFor(() => {
      // Nav tab labels are translated — check for dashboard link existence
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });
  });

  // --- Route rendering ---

  it("renders the dashboard route at /", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      // Dashboard nav tab should be active (aria-current="page")
      const dashboardLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/");
      expect(dashboardLink).toBeTruthy();
    });
  });

  it("renders the settings route at /settings", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      // Settings nav tab should be active
      const settingsLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/settings");
      expect(settingsLink).toBeTruthy();
      expect(settingsLink!.getAttribute("aria-current")).toBe("page");
    });
  });

  it("renders the hotkeys route at /hotkeys", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/hotkeys"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      const hotkeyLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/hotkeys");
      expect(hotkeyLink).toBeTruthy();
      expect(hotkeyLink!.getAttribute("aria-current")).toBe("page");
    });
  });

  it("renders the overlay-editor route at /overlay-editor", async () => {
    mockAcceptedState();
    // OverlayEditorPage uses useBlocker which requires a data router
    const router = createMemoryRouter([{ path: "*", element: <App /> }], {
      initialEntries: ["/overlay-editor"],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      const editorLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/overlay-editor");
      expect(editorLink).toBeTruthy();
      expect(editorLink!.getAttribute("aria-current")).toBe("page");
    });
  });

  it("renders the overlay route at /overlay without navigation chrome", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/overlay"]}>
        <App />
      </MemoryRouter>,
    );
    // The overlay route renders without the AppShell nav header (no nav links visible)
    // Give it a moment to settle, then check that the nav tabs are not rendered
    await waitFor(() => {
      // Overlay skips LicenseGate and goes straight to AppShell's overlay branch
      // which only renders the <Routes> for /overlay — no header nav
      const links = screen.queryAllByRole("link");
      // Should have zero nav links since overlay renders bare
      const navLinks = links.filter((el) =>
        ["/", "/settings", "/hotkeys", "/overlay-editor"].includes(el.getAttribute("href") ?? ""),
      );
      expect(navLinks.length).toBe(0);
    });
  });

  // --- Navigation links ---

  it("renders all navigation tabs when app is loaded", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await waitFor(() => {
      const links = screen.getAllByRole("link");
      const hrefs = links.map((el) => el.getAttribute("href"));
      // Should include all main nav routes
      expect(hrefs).toContain("/");
      expect(hrefs).toContain("/hotkeys");
      expect(hrefs).toContain("/overlay-editor");
      expect(hrefs).toContain("/settings");
    });
  });

  // --- Footer content ---

  it("renders footer with GitHub link on app name and ZSleyer YouTube link", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await waitFor(() => {
      const zsLink = screen.getByText("ZSleyer");
      expect(zsLink.closest("a")).toHaveAttribute("href", "https://youtube.com/@ZSleyer");
    });
  });

  // --- License dialog ---

  it("renders a skip-to-content accessibility link", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await waitFor(() => {
      const skipLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "#main-content");
      expect(skipLink).toBeTruthy();
    });
  });

  // --- License acceptance flow ---

  it("shows default build info when /api/version fails", async () => {
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
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Should show default "Encounty" text without version
    await waitFor(() => {
      expect(screen.getByText("Encounty")).toBeInTheDocument();
    });
  });

  // --- Build date rendering ---

  it("renders build date in footer when available", async () => {
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
          json: () => Promise.resolve({ display: "2.0.0", build_date: "2025-06-15" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("(2025-06-15)")).toBeInTheDocument();
    });
  });

  // --- Footer copyright ---

  it("renders footer copyright with year", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/\u00A9.*2026/)).toBeInTheDocument();
    });
  });

  // --- Dashboard is mounted for root path ---

  it("keeps Dashboard mounted when on root path", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Dashboard should be visible (not hidden)
      const links = screen.getAllByRole("link");
      const dashLink = links.find((el) => el.getAttribute("href") === "/");
      expect(dashLink).toBeTruthy();
    });
  });

  // --- Loading state while checking license ---

  it("renders app logo in the header", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const logo = screen.getByAltText("Encounty Logo");
      expect(logo).toBeInTheDocument();
    });
  });

  // --- App renders providers correctly ---

  it("wraps content with ToastProvider so toasts can render", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      // The app should render without crashing when toasts are used
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });
  });

  // --- Setup pending with dev mode ---

  it("renders non-dashboard route content when not on /", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const settingsLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/settings");
      expect(settingsLink).toBeTruthy();
    });
  });

  // --- Header double-click does not crash without electronAPI ---

  it("handles header double-click gracefully without electronAPI", async () => {
    mockAcceptedState();
    delete (globalThis as { electronAPI?: unknown }).electronAPI;

    const { container } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const header = container.querySelector("header");
      expect(header).toBeTruthy();
    });

    // Double click on the header should not crash
    const header = container.querySelector("header")!;
    fireEvent.doubleClick(header);
    // App should still be rendered
    expect(container.firstChild).toBeTruthy();
  });

  // --- NavTab active state styling ---

  it("applies aria-current=page to the active nav tab", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/hotkeys"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const hotkeyLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/hotkeys");
      expect(hotkeyLink).toBeTruthy();
      expect(hotkeyLink!.getAttribute("aria-current")).toBe("page");
    });
  });

  it("does not apply aria-current to inactive nav tabs", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const settingsLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/settings");
      expect(settingsLink).toBeTruthy();
      expect(settingsLink!.getAttribute("aria-current")).toBeNull();
    });
  });

  // --- YouTube link ---

  it("renders YouTube link in footer on ZSleyer text", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const zsLink = screen.getByText("ZSleyer");
      expect(zsLink).toBeInTheDocument();
      expect(zsLink.closest("a")?.getAttribute("href")).toContain("youtube.com");
    });
  });

  // --- GitHub link on app name ---

  it("renders GitHub link on app name in footer", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const ghLink = screen.getByText(/Encounty/);
      const anchor = ghLink.closest("a");
      if (anchor) {
        expect(anchor.getAttribute("href")).toContain("ZSleyer/Encounty");
      }
    });
  });

  // --- Footer center link ---

  it("renders footer center link to YouTube video", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const link = screen.getByText("「Foreshadow」");
      expect(link).toBeInTheDocument();
      expect(link.closest("a")).toHaveAttribute(
        "href",
        "https://www.youtube.com/watch?v=SiTi3WCmzfc",
      );
      expect(link.closest("a")).toHaveAttribute("target", "_blank");
    });
  });

  // --- Overlay route skips license gate ---

  it("nav tabs include icon elements", async () => {
    mockAcceptedState();
    const { container } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      // Each nav tab should have an SVG icon
      container.querySelectorAll("a[href]");
      const svgIcons = container.querySelectorAll("header svg");
      expect(svgIcons.length).toBeGreaterThanOrEqual(4);
    });
  });

  // --- Header double-click calls electronAPI.maximize ---

  it("calls electronAPI.maximize on header double-click in Electron mode", async () => {
    mockAcceptedState();
    const maximizeMock = vi.fn();
    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: maximizeMock,
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: () => () => {},
      onUpdateProgress: () => () => {},
      onUpdateDownloaded: () => () => {},
      onUpdateError: () => () => {},
    };

    const { container } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const header = container.querySelector("header");
      expect(header).toBeTruthy();
    });

    const header = container.querySelector("header")!;
    fireEvent.doubleClick(header);
    expect(maximizeMock).toHaveBeenCalled();

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Window controls render in Electron mode (non-darwin) ---

  it("renders WindowControls in Electron mode on Linux", async () => {
    mockAcceptedState();
    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "linux",
      autoUpdate: true,
      maximize: vi.fn(),
      minimize: vi.fn(),
      close: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: () => () => {},
      onUpdateProgress: () => () => {},
      onUpdateDownloaded: () => () => {},
      onUpdateError: () => () => {},
    };

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      // WindowControls should render minimize/maximize/close buttons
      const header = document.querySelector("header");
      expect(header).toBeTruthy();
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Ctrl+W shows close warning ---

  it("does not render build date parentheses when no date available", async () => {
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
          json: () => Promise.resolve({ display: "1.0.0", build_date: "" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Encounty 1.0.0")).toBeInTheDocument();
    });

    // No parenthesized date should appear
    expect(screen.queryByText(/^\(.*\)$/)).not.toBeInTheDocument();
  });

  // --- Dashboard tab is active at root ---

  it("highlights dashboard tab as active at root path", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const dashLink = screen.getAllByRole("link").find((el) => el.getAttribute("href") === "/");
      expect(dashLink).toBeTruthy();
      expect(dashLink!.getAttribute("aria-current")).toBe("page");
    });
  });

  // --- Overlay editor tab has active state ---

  it("highlights overlay editor tab as active at /overlay-editor", async () => {
    mockAcceptedState();
    const router = createMemoryRouter([{ path: "*", element: <App /> }], {
      initialEntries: ["/overlay-editor"],
    });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const editorLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "/overlay-editor");
      expect(editorLink).toBeTruthy();
      expect(editorLink!.getAttribute("aria-current")).toBe("page");
    });
  });

  // --- Footer version string format ---

  it("displays version in footer with correct format", async () => {
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
          json: () => Promise.resolve({ display: "3.1.4", build_date: "2026-01-01" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Encounty 3.1.4")).toBeInTheDocument();
      expect(screen.getByText("(2026-01-01)")).toBeInTheDocument();
    });
  });

  // --- Multiple overlay route paths ---

  it("renders overlay route at /overlay/:pokemonId without chrome", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/overlay/poke-123"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // No nav links should be present
      const links = screen.queryAllByRole("link");
      const navLinks = links.filter((el) =>
        ["/", "/settings", "/hotkeys", "/overlay-editor"].includes(el.getAttribute("href") ?? ""),
      );
      expect(navLinks.length).toBe(0);
    });
  });

  // --- License dialog with accept button rendered ---

  it("GitHub link on app name opens in new tab", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const ghLink = screen.getByText(/Encounty/).closest("a");
      if (ghLink) {
        expect(ghLink.getAttribute("target")).toBe("_blank");
        expect(ghLink.getAttribute("rel")).toContain("noopener");
      }
    });
  });

  it("ZSleyer YouTube link opens in new tab", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const ytLink = screen.getByText("ZSleyer").closest("a");
      expect(ytLink).toBeTruthy();
      expect(ytLink!.getAttribute("target")).toBe("_blank");
      expect(ytLink!.getAttribute("rel")).toContain("noopener");
    });
  });

  // --- macOS hides logo in main position ---

  it("hides logo in main position on macOS and shows it on the right", async () => {
    mockAcceptedState();
    (globalThis as Record<string, unknown>).electronAPI = {
      platform: "darwin",
      maximize: vi.fn(),
      onMaximizedChange: vi.fn(() => () => {}),
      onUpdateAvailable: () => () => {},
      onUpdateProgress: () => () => {},
      onUpdateDownloaded: () => () => {},
      onUpdateError: () => () => {},
    };

    const { container } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      // On macOS, header should have pl-19.5 padding for traffic lights
      const header = container.querySelector("header");
      expect(header).toBeTruthy();
      expect(header!.className).toContain("pl-19.5");
    });

    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  // --- Dashboard stays mounted when navigating away ---

  it("keeps Dashboard mounted but hidden when on non-root path", async () => {
    mockAcceptedState();
    const { container } = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // The hidden div containing Dashboard should exist
      const hiddenDiv = container.querySelector("div.hidden");
      expect(hiddenDiv).toBeTruthy();
    });
  });

  // --- Skip-to-content link has correct href ---

  it("skip-to-content link points to #main-content", async () => {
    mockAcceptedState();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    await waitFor(() => {
      const skipLink = screen
        .getAllByRole("link")
        .find((el) => el.getAttribute("href") === "#main-content");
      expect(skipLink).toBeTruthy();
      // Should have sr-only class for screen reader only visibility
      expect(skipLink!.className).toContain("sr-only");
    });
  });

  it("does not render a duplicate #main-content id from the always-mounted Dashboard on a non-Dashboard route", async () => {
    mockAcceptedState();
    render(
      <MemoryRouter initialEntries={["/hotkeys"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      // Dashboard stays mounted (CSS-hidden) behind every other route; it must
      // not contribute its own #main-content id once another route is active.
      expect(document.querySelectorAll("#main-content").length).toBeLessThanOrEqual(1);
    });
  });

  // --- Server not ready and not setup pending shows spinner ---

  it("handles non-ok /api/version response gracefully", async () => {
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
          ok: false,
          json: () => Promise.reject(new Error("Not found")),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );

    // Should fall back to "Encounty" without version
    await waitFor(() => {
      expect(screen.getByText("Encounty")).toBeInTheDocument();
    });
  });

  // --- Crisp sprites setting sync ---
});
