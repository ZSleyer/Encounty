import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../../test-utils";
import { NumInput, NumSlider } from "./NumSlider";

describe("NumInput", () => {
  it("renders with current value", () => {
    render(<NumInput value={42} onChange={vi.fn()} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(42);
  });

  it("calls onChange when input value changes", () => {
    const onChange = vi.fn();
    render(<NumInput value={10} onChange={onChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith(25);
  });

  it("increments value when + button clicked", () => {
    const onChange = vi.fn();
    render(<NumInput value={5} min={0} max={10} onChange={onChange} />);
    fireEvent.click(screen.getByText("+"));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it("decrements value when - button clicked", () => {
    const onChange = vi.fn();
    render(<NumInput value={5} min={0} max={10} onChange={onChange} />);
    fireEvent.click(screen.getByText("−"));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("respects max bound on increment", () => {
    const onChange = vi.fn();
    render(<NumInput value={10} min={0} max={10} onChange={onChange} />);
    fireEvent.click(screen.getByText("+"));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("respects min bound on decrement", () => {
    const onChange = vi.fn();
    render(<NumInput value={0} min={0} max={10} onChange={onChange} />);
    fireEvent.click(screen.getByText("−"));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe("NumSlider", () => {
  it("renders with label and current value", () => {
    render(
      <NumSlider label="Opacity" value={50} min={0} max={100} onChange={vi.fn()} />,
    );
    expect(screen.getByText("Opacity")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(50);
  });

  it("renders a range slider input", () => {
    render(
      <NumSlider label="Width" value={10} min={1} max={20} onChange={vi.fn()} />,
    );
    const slider = screen.getByRole("slider");
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "20");
  });

  it("calls onChange when slider value changes", () => {
    const onChange = vi.fn();
    render(
      <NumSlider label="Blur" value={5} min={0} max={40} onChange={onChange} />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("calls onChange when numeric input value changes", () => {
    const onChange = vi.fn();
    render(
      <NumSlider label="Size" value={12} min={1} max={100} onChange={onChange} />,
    );
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(30);
  });
});
