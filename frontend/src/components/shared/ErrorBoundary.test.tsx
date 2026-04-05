import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

/** Helper component that throws on demand. */
function ThrowError({ shouldThrow }: Readonly<{ shouldThrow: boolean }>) {
  if (shouldThrow) throw new Error("Test error");
  return <div>OK</div>;
}

describe("ErrorBoundary", () => {
  it("renders children normally when no error occurs", () => {
    render(
      <ErrorBoundary>
        <p>Hello world</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("shows fallback UI when a child throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.queryByText("OK")).not.toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("shows the default message when no fallbackMessage is provided", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow />
      </ErrorBoundary>,
    );

    expect(
      screen.getByText("Something went wrong. Try again or reload the page."),
    ).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("shows a custom fallbackMessage when provided", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary fallbackMessage="Custom error text">
        <ThrowError shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom error text")).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong. Try again or reload the page."),
    ).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("has correct ARIA role='alert' on the fallback container", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("resets error state and re-renders children when Retry is clicked", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary>
        <ThrowError shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Re-render with a non-throwing child so recovery succeeds
    rerender(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Retry"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
