import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { ColorSwatch } from "./ColorSwatch";

describe("ColorSwatch", () => {
  it("renders as a button", () => {
    render(<ColorSwatch color="#ff0000" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<ColorSwatch color="#00ff00" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("displays label text when provided", () => {
    render(<ColorSwatch color="#0000ff" label="Background" />);
    expect(screen.getByText(/Background/)).toBeInTheDocument();
    expect(screen.getByText("#0000ff")).toBeInTheDocument();
  });

  it("shows gradient label when gradient prop is provided", () => {
    render(
      <ColorSwatch
        color="#ffffff"
        label="Fill"
        gradient={{
          stops: [
            { color: "#ff0000", position: 0 },
            { color: "#0000ff", position: 100 },
          ],
          angle: 90,
        }}
      />,
    );
    expect(screen.getByText(/Fill/)).toBeInTheDocument();
    // When gradient is provided, the label shows "Verlauf" instead of hex
    expect(screen.getByText("Verlauf")).toBeInTheDocument();
  });
});
