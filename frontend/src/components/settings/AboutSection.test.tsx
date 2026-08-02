import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils";
import { AboutSection } from "./AboutSection";

const t = (key: string) => key;

describe("AboutSection", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)),
    );
  });

  it("credits every contributor with a safe external link", () => {
    render(<AboutSection t={t} />);
    for (const name of ["ZSleyer", "Lunix-420"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", `https://github.com/${name}`);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("credits the odds sources alongside the sprite sources", async () => {
    const user = userEvent.setup();
    render(<AboutSection t={t} />);
    await user.click(screen.getByRole("button", { name: /licenses.dataSources/ }));
    for (const name of ["Bulbapedia", "Smogon", "RotomLabs", "PokéWiki", "r/pokemon (Reddit)"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("exposes the expanded state of every disclosure", async () => {
    const user = userEvent.setup();
    render(<AboutSection t={t} />);
    for (const key of ["licenses.title", "licenses.dataSources", "licenses.trademarkTitle"]) {
      const button = screen.getByRole("button", { name: new RegExp(key) });
      expect(button).toHaveAttribute("aria-expanded", "false");
      await user.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
    }
  });
});
