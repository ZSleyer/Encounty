import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { WindowControls } from "./WindowControls";

describe("WindowControls", () => {
  const mockAPI = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    onMaximizedChange: vi.fn(() => vi.fn()),
  };

  beforeEach(() => {
    vi.stubGlobal("electronAPI", mockAPI);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing when electronAPI is not available", () => {
    vi.stubGlobal("electronAPI", undefined);
    const { container } = render(<WindowControls />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders minimize, maximize, and close buttons", () => {
    render(<WindowControls />);
    expect(screen.getByTitle("Minimize")).toBeInTheDocument();
    expect(screen.getByTitle("Maximize")).toBeInTheDocument();
    expect(screen.getByTitle("Close")).toBeInTheDocument();
  });

  it("calls minimize when minimize button is clicked", () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByTitle("Minimize"));
    expect(mockAPI.minimize).toHaveBeenCalledOnce();
  });

  it("calls maximize when maximize button is clicked", () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByTitle("Maximize"));
    expect(mockAPI.maximize).toHaveBeenCalledOnce();
  });

  it("calls close when close button is clicked", () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByTitle("Close"));
    expect(mockAPI.close).toHaveBeenCalledOnce();
  });

  it("shows Restore title when maximized state is true", () => {
    // Simulate the onMaximizedChange callback firing with true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAPI.onMaximizedChange.mockImplementation(((cb: (v: boolean) => void) => {
      cb(true);
      return vi.fn();
    }) as any);
    render(<WindowControls />);
    expect(screen.getByTitle("Restore")).toBeInTheDocument();
  });

  it("registers onMaximizedChange listener on mount", () => {
    // Reset mock to clear calls from other tests
    mockAPI.onMaximizedChange.mockClear();
    mockAPI.onMaximizedChange.mockReturnValue(vi.fn());
    render(<WindowControls />);
    expect(mockAPI.onMaximizedChange).toHaveBeenCalledOnce();
  });
});
