import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "./ToastContext";

/** Component that uses useToast outside of ToastProvider, used to test error handling. */
function Orphan() {
  useToast();
  return null;
}

/** Test component that exposes toast state and actions. */
function ToastTester() {
  const { toasts, push, dismiss } = useToast();
  return (
    <div>
      <span data-testid="count">{toasts.length}</span>
      <ul data-testid="toast-list">
        {toasts.map((t) => (
          <li key={t.id} data-testid={`toast-${t.id}`}>
            {t.title}
          </li>
        ))}
      </ul>
      {/* Expose push/dismiss via window for test access */}
      <button
        data-testid="push-info"
        onClick={() => push({ type: "info", title: "Info toast" })}
      >
        push-info
      </button>
      <button
        data-testid="push-encounter"
        onClick={() =>
          push({ type: "encounter", title: "Encounter!", spriteUrl: "/pikachu.png" })
        }
      >
        push-encounter
      </button>
      <button
        data-testid="dismiss-first"
        onClick={() => {
          if (toasts.length > 0) dismiss(toasts[0].id);
        }}
      >
        dismiss-first
      </button>
    </div>
  );
}

/** Helper to render the test component inside ToastProvider. */
function renderToastTester() {
  return render(
    <ToastProvider>
      <ToastTester />
    </ToastProvider>,
  );
}

describe("ToastContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // crypto.randomUUID is needed by ToastProvider; stub it with a counter
    let uuidCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `uuid-${++uuidCounter}`,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts with no toasts", () => {
    renderToastTester();
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("push adds a toast", () => {
    renderToastTester();

    act(() => {
      screen.getByTestId("push-info").click();
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("dismiss removes a toast", () => {
    renderToastTester();

    act(() => screen.getByTestId("push-info").click());
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => screen.getByTestId("dismiss-first").click());
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("auto-dismisses info toast after 2000ms", () => {
    renderToastTester();

    act(() => screen.getByTestId("push-info").click());
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("auto-dismisses encounter toast after 3000ms", () => {
    renderToastTester();

    act(() => screen.getByTestId("push-encounter").click());
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("caps toast stack at 5", () => {
    renderToastTester();

    for (let i = 0; i < 7; i++) {
      act(() => screen.getByTestId("push-info").click());
    }

    expect(screen.getByTestId("count").textContent).toBe("5");
  });

  it("encounter toasts replace existing toast with same sprite", () => {
    renderToastTester();

    // Push two encounter toasts with the same spriteUrl
    act(() => screen.getByTestId("push-encounter").click());
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => screen.getByTestId("push-encounter").click());
    // Should still be 1 because the second replaces the first
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("useToast throws when used outside ToastProvider", () => {
    // Suppress React error boundary console noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow("useToast must be used within ToastProvider");
    spy.mockRestore();
  });

  it("shows system notification when page hidden and permission granted", () => {
    const notificationSpy = vi.fn();
    vi.stubGlobal("Notification", Object.assign(
      function MockNotification(...args: unknown[]) { notificationSpy(...args); },
      { permission: "granted", requestPermission: vi.fn() },
    ));
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });

    renderToastTester();
    act(() => screen.getByTestId("push-info").click());

    expect(notificationSpy).toHaveBeenCalledWith("Info toast", expect.objectContaining({ body: undefined }));

    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });

  it("requests notification permission when not denied", async () => {
    const notificationSpy = vi.fn();
    const requestMock = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", Object.assign(
      function MockNotification(...args: unknown[]) { notificationSpy(...args); },
      { permission: "default", requestPermission: requestMock },
    ));
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });

    renderToastTester();
    act(() => screen.getByTestId("push-info").click());

    expect(requestMock).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(notificationSpy).toHaveBeenCalled();
    });

    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });

  it("does not show notification when page is visible", () => {
    const notificationSpy = vi.fn();
    vi.stubGlobal("Notification", Object.assign(
      function MockNotification(...args: unknown[]) { notificationSpy(...args); },
      { permission: "granted", requestPermission: vi.fn() },
    ));

    renderToastTester();
    act(() => screen.getByTestId("push-info").click());

    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it("does not request permission when denied", () => {
    const requestMock = vi.fn();
    vi.stubGlobal("Notification", Object.assign(
      function MockNotification() { /* no-op */ },
      { permission: "denied", requestPermission: requestMock },
    ));
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });

    renderToastTester();
    act(() => screen.getByTestId("push-info").click());

    expect(requestMock).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });
});
