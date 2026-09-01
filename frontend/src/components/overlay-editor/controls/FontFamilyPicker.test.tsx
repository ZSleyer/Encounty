import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "../../../test-utils";
import { FontFamilyPicker } from "./FontFamilyPicker";
import { resetLocalFontCache } from "../../../hooks/useLocalFonts";

const REQUEST_BUTTON = "Schriftarten von diesem PC verwenden";

/** Installs a fake Local Font Access API on the global object. */
function stubQueryLocalFonts(impl: () => Promise<unknown>) {
  Object.defineProperty(globalThis, "queryLocalFonts", {
    value: impl,
    writable: true,
    configurable: true,
  });
}

/** Returns the family `<select>`, located the way the panel labels it. */
function fontSelect(): HTMLSelectElement {
  return screen.getByText("Schriftart").closest("label")!.querySelector("select")!;
}

describe("FontFamilyPicker", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "queryLocalFonts");
    resetLocalFontCache();
  });

  // --- Degradation without the Local Font Access API (jsdom, Firefox, OBS) ---

  it("keeps the curated groups and hides the permission button", () => {
    render(<FontFamilyPicker value="sans" onChange={vi.fn()} />);
    const select = fontSelect();
    expect(select.value).toBe("sans");
    expect(select).toHaveAccessibleName("Schriftart");
    expect(screen.getByRole("option", { name: "Roboto" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "monospace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REQUEST_BUTTON })).not.toBeInTheDocument();
  });

  it("still reports the selection when a curated font is picked", () => {
    const onChange = vi.fn();
    render(<FontFamilyPicker value="sans" onChange={onChange} />);
    fireEvent.change(fontSelect(), { target: { value: "Roboto" } });
    expect(onChange).toHaveBeenCalledWith("Roboto");
  });

  it("accepts a hand-typed family through the free-text field", () => {
    const onChange = vi.fn();
    render(<FontFamilyPicker value="sans" onChange={onChange} />);
    const custom = screen.getByText("Eigene Schriftart").closest("label")!.querySelector("input")!;
    fireEvent.change(custom, { target: { value: "Comic Sans MS" } });
    expect(onChange).toHaveBeenCalledWith("Comic Sans MS");
  });

  it("keeps an unlisted family selectable in its own group", () => {
    render(<FontFamilyPicker value="Comic Sans MS" onChange={vi.fn()} />);
    expect(fontSelect().value).toBe("Comic Sans MS");
  });

  // --- With the Local Font Access API present ---

  it("lists the families when the permission is already granted on mount", async () => {
    stubQueryLocalFonts(() =>
      Promise.resolve([{ family: "Fira Sans" }, { family: "Fira Sans" }, { family: "Arial" }]),
    );
    render(<FontFamilyPicker value="sans" onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Fira Sans" })).toBeInTheDocument();
    });
    expect(screen.getByRole("option", { name: "Arial" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: REQUEST_BUTTON })).not.toBeInTheDocument();
  });

  it("loads the families after the user asks for access", async () => {
    let granted = false;
    stubQueryLocalFonts(() => {
      if (!granted) {
        granted = true;
        return Promise.reject(new Error("no user activation"));
      }
      return Promise.resolve([{ family: "Menlo" }]);
    });
    render(<FontFamilyPicker value="sans" onChange={vi.fn()} />);
    const button = await screen.findByRole("button", { name: REQUEST_BUTTON });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Menlo" })).toBeInTheDocument();
    });
  });

  it("announces a refused permission politely", async () => {
    stubQueryLocalFonts(() => Promise.reject(new Error("denied")));
    render(<FontFamilyPicker value="sans" onChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: REQUEST_BUTTON }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Kein Zugriff auf die Schriftarten dieses PCs.",
      );
    });
  });

  it("announces an empty font list", async () => {
    stubQueryLocalFonts(() => Promise.resolve([]));
    render(<FontFamilyPicker value="sans" onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Keine Schriftarten auf diesem PC gefunden.",
      );
    });
  });
});
