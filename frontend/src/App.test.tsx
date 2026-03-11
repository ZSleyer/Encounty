import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { App } from "./App";

vi.stubGlobal(
  "fetch",
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ display: "1.0.0", build_date: "2024-01-01" }),
    }),
  ),
);

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
});
