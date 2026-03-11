import { describe, it, expect } from "vitest";
import { render, screen } from "../test-utils";
import { CountryFlag } from "./CountryFlag";

describe("CountryFlag", () => {
  it("renders an SVG flag for a known language code", () => {
    const { container } = render(<CountryFlag code="de" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders nothing for an unknown language code", () => {
    const { container } = render(<CountryFlag code="xx" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders GB flag for 'en' code", () => {
    const { container } = render(<CountryFlag code="en" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<CountryFlag code="fr" className="w-8 h-6" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("w-8");
    expect(svg).toHaveClass("h-6");
  });
});
