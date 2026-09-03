import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { LanguageMenu } from "./LanguageMenu";

describe("LanguageMenu", () => {
  it("shows the picked language by default", () => {
    render(
      <LanguageMenu language="de" availableLangs={["de", "en"]} anchorName="--a" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Lokalisierung" })).toHaveTextContent("Deutsch");
  });

  it("shows the auto label and offers an auto entry when autoLabel is set", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LanguageMenu
        language=""
        availableLangs={["de", "en"]}
        anchorName="--a"
        onChange={onChange}
        autoLabel="UI-Sprache"
        label="Namenssprache"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Namenssprache" });
    expect(trigger).toHaveTextContent("UI-Sprache");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(onChange).toHaveBeenCalledWith("de");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "UI-Sprache" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
