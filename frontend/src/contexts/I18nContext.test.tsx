import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "../locales";
import { I18nProvider, useI18n } from "./I18nContext";

/** Test component that displays locale and allows switching. */
function I18nTester() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="translated">{t("app.name")}</span>
      <button onClick={() => setLocale("en")}>switch-en</button>
      <button onClick={() => setLocale("de")}>switch-de</button>
    </div>
  );
}

describe("I18nContext", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
    void i18n.changeLanguage("de");
  });

  it("defaults to 'de' locale when localStorage is empty", () => {
    render(
      <I18nProvider>
        <I18nTester />
      </I18nProvider>,
    );

    expect(screen.getByTestId("locale").textContent).toBe("de");
  });

  it("reads initial locale from i18next", () => {
    void i18n.changeLanguage("en");

    render(
      <I18nProvider>
        <I18nTester />
      </I18nProvider>,
    );

    expect(screen.getByTestId("locale").textContent).toBe("en");
  });

  it("setLocale switches the locale", async () => {
    render(
      <I18nProvider>
        <I18nTester />
      </I18nProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("switch-en"));
    });
    expect(screen.getByTestId("locale").textContent).toBe("en");

    await act(async () => {
      fireEvent.click(screen.getByText("switch-de"));
    });
    expect(screen.getByTestId("locale").textContent).toBe("de");
  });

  it("persists locale to localStorage on change", async () => {
    render(
      <I18nProvider>
        <I18nTester />
      </I18nProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("switch-en"));
    });
    expect(localStorage.getItem("encounty-locale")).toBe("en");
  });

  it("sets document.documentElement.lang on locale change", async () => {
    render(
      <I18nProvider>
        <I18nTester />
      </I18nProvider>,
    );

    expect(document.documentElement.lang).toBe("de");

    await act(async () => {
      fireEvent.click(screen.getByText("switch-en"));
    });
    expect(document.documentElement.lang).toBe("en");
  });

  it("t() returns a translated string for a known key", () => {
    render(
      <I18nProvider>
        <I18nTester />
      </I18nProvider>,
    );

    expect(screen.getByTestId("translated").textContent).toBe("Encounty");
  });
});
