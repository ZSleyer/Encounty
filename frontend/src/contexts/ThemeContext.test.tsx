import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";

/** Test component that displays and toggles the theme. */
function ThemeTester() {
  const { theme, toggleTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => setTheme("light")}>set-light</button>
    </div>
  );
}

describe("ThemeContext", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark when localStorage is empty", () => {
    render(
      <ThemeProvider>
        <ThemeTester />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("reads initial theme from localStorage", () => {
    localStorage.setItem("encounty-theme", "light");

    render(
      <ThemeProvider>
        <ThemeTester />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("toggleTheme switches from dark to light and back", () => {
    render(
      <ThemeProvider>
        <ThemeTester />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("dark");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("theme").textContent).toBe("light");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("setTheme sets the theme directly", () => {
    render(
      <ThemeProvider>
        <ThemeTester />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("set-light"));
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("persists theme to localStorage on change", () => {
    render(
      <ThemeProvider>
        <ThemeTester />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("toggle"));
    expect(localStorage.getItem("encounty-theme")).toBe("light");
  });

  it("sets data-theme attribute on document element", () => {
    render(
      <ThemeProvider>
        <ThemeTester />
      </ThemeProvider>,
    );

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByText("toggle"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
