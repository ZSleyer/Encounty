import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "./useWebSocket";

/** Minimal mock WebSocket that exposes handlers for manual triggering. */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /** Simulate the server accepting the connection. */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** Simulate receiving a message from the server. */
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  /** Simulate the connection closing. */
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  /** Simulate a connection error. */
  simulateError() {
    this.onerror?.(new Event("error"));
  }

  static readonly instances: MockWebSocket[] = [];
  static clear() {
    MockWebSocket.instances.length = 0;
  }
  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.clear();
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects on mount", () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toContain("/ws");
  });

  it("calls onConnect when the socket opens", () => {
    const onMessage = vi.fn();
    const onConnect = vi.fn();
    renderHook(() => useWebSocket(onMessage, onConnect));

    act(() => MockWebSocket.latest().simulateOpen());
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("calls onMessage with parsed JSON on incoming message", () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());
    act(() => ws.simulateMessage({ type: "state_update", payload: { foo: 1 } }));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: "state_update", payload: { foo: 1 } });
  });

  it("calls onDisconnect when the socket closes", () => {
    const onMessage = vi.fn();
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    renderHook(() => useWebSocket(onMessage, onConnect, onDisconnect));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());
    act(() => ws.simulateClose());

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("reconnects after RECONNECT_DELAY ms on close", () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());
    act(() => ws.simulateClose());

    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(2000));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("send() transmits JSON when socket is open", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());

    act(() => result.current.send("increment", { id: "poke-1" }));
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "increment", payload: { id: "poke-1" } }),
    );
  });

  it("send() does nothing when socket is not open", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    // Socket is still CONNECTING (not open)
    act(() => result.current.send("increment", {}));
    expect(MockWebSocket.latest().send).not.toHaveBeenCalled();
  });

  it("cleans up on unmount: closes socket and clears reconnect timer", () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());
    act(() => ws.simulateClose());

    // Reconnect timer is now pending
    unmount();

    // After unmount, advancing timers should NOT create a new connection
    const countBefore = MockWebSocket.instances.length;
    act(() => vi.advanceTimersByTime(5000));
    expect(MockWebSocket.instances).toHaveLength(countBefore);
  });

  it("error on socket triggers close", () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateError());
    expect(ws.close).toHaveBeenCalled();
  });

  it("does not call onMessage when JSON parsing fails", () => {
    const onMessage = vi.fn();
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());

    // Send raw invalid JSON — bypass simulateMessage to avoid pre-stringifying
    act(() => {
      ws.onmessage?.(new MessageEvent("message", { data: "not valid json{{{" }));
    });

    expect(onMessage).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[WS] Failed to parse message:",
      "not valid json{{{",
    );
    consoleSpy.mockRestore();
  });

  it("does not reconnect if already OPEN", () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());

    // Only 1 instance should exist — connect() should bail if already OPEN
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not call onConnect when no onConnect callback is provided", () => {
    const onMessage = vi.fn();
    // Only pass onMessage, no onConnect
    renderHook(() => useWebSocket(onMessage));

    const ws = MockWebSocket.latest();
    // Should not throw when opening without onConnect callback
    act(() => ws.simulateOpen());

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not call onDisconnect when no onDisconnect callback is provided", () => {
    const onMessage = vi.fn();
    const onConnect = vi.fn();
    // No onDisconnect provided
    renderHook(() => useWebSocket(onMessage, onConnect));

    const ws = MockWebSocket.latest();
    act(() => ws.simulateOpen());
    // Should not throw when closing without onDisconnect callback
    act(() => ws.simulateClose());

    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
