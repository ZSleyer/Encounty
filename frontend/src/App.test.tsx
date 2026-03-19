import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { App } from "./App";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ display: "1.0.0", build_date: "2024-01-01" }),
  });
  vi.stubGlobal("fetch", mockFetch);
});

vi.mock("./hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(() => ({ send: vi.fn() })),
}));

vi.mock("./contexts/CaptureServiceContext", () => ({
  CaptureServiceProvider: ({ children }: { children: React.ReactNode }) => children,
  useCaptureService: () => ({
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    getStream: () => null,
    isCapturing: () => false,
    registerSubmitter: vi.fn(),
    unregisterSubmitter: vi.fn(),
    updateSubmitterInterval: vi.fn(),
    captureError: null,
  }),
  useCaptureVersion: () => 0,
}));

describe("App", () => {
  it("renders without crashing", () => {
    // App does not include BrowserRouter, so wrap it here.
    // App contains ThemeProvider, I18nProvider, ToastProvider already.
    const { container } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    expect(container).toBeTruthy();
  });

  it("fetches and displays version information", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/version") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display: "1.2.3", build_date: "2024-03-19" }),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ license_accepted: true, pokemon: [], settings: {}, hotkeys: {} }),
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
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ license_accepted: true, pokemon: [], settings: {}, hotkeys: {} }),
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
      expect(document.documentElement.getAttribute("data-theme")).toBeTruthy();
    });
  });

  it("does not render WindowControls in non-Electron mode", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ license_accepted: true, pokemon: [], settings: {}, hotkeys: {} }),
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
});
