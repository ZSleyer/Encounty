/**
 * ThemeContext.tsx — Dark/light theme context.
 *
 * The chosen theme is persisted to localStorage under "encounty-theme" and
 * applied as a `data-theme` attribute on `<html>` for CSS variable switching.
 * Defaults to "dark" if no preference is stored.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

/** ThemeProvider wraps the app with theme state and toggle/set helpers. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("encounty-theme");
    return (saved === "light" ? "light" : "dark") as Theme;
  });

  useEffect(() => {
    localStorage.setItem("encounty-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** useTheme returns the current theme and helpers to toggle or set it. */
export function useTheme() {
  return useContext(ThemeContext);
}
