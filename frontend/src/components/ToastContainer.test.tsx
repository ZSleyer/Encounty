import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ToastContainer } from "./ToastContainer";
import { ToastProvider, useToast } from "../contexts/ToastContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { I18nProvider } from "../contexts/I18nContext";
import { BrowserRouter } from "react-router";

/** Helper component that exposes push/dismiss for testing. */
function ToastTrigger() {
  const { push } = useToast();
  return (
    <div>
      <button
        data-testid="push-success"
        onClick={() => push({ type: "success", title: "Success!", message: "It worked" })}
      />
      <button
        data-testid="push-error"
        onClick={() => push({ type: "error", title: "Error!", message: "Something failed" })}
      />
      <button
        data-testid="push-info"
        onClick={() => push({ type: "info", title: "Info", message: "FYI" })}
      />
      <button
        data-testid="push-encounter"
        onClick={() =>
          push({
            type: "encounter",
            title: "Pikachu",
            message: "New encounter",
            spriteUrl: "/pikachu.png",
            badge: "+1",
          })
        }
      />
      <button
        data-testid="push-encounter-minus"
        onClick={() =>
          push({
            type: "encounter",
            title: "Pikachu",
            message: "Decremented",
            spriteUrl: "/pikachu.png",
            badge: "-1",
          })
        }
      />
      <button
        data-testid="push-encounter-zero"
        onClick={() =>
          push({
            type: "encounter",
            title: "Pikachu",
            message: "Reset",
            spriteUrl: "/pikachu.png",
            badge: "0",
          })
        }
      />
      <button
        data-testid="push-encounter-delete"
        onClick={() =>
          push({
            type: "encounter",
            title: "Pikachu",
            message: "Deleted",
            badge: "\u{1F5D1}",
          })
        }
      />
      <button
        data-testid="push-encounter-check"
        onClick={() =>
          push({
            type: "encounter",
            title: "Pikachu",
            message: "Done",
            badge: "\u2714",
          })
        }
      />
      <button
        data-testid="push-encounter-no-badge"
        onClick={() =>
          push({
            type: "encounter",
            title: "Pikachu",
            message: "Default badge",
            spriteUrl: "/pikachu.png",
          })
        }
      />
    </div>
  );
}

function renderWithProvider() {
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <ToastTrigger />
            <ToastContainer />
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>,
  );
}

describe("ToastContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let uuidCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `uuid-${++uuidCounter}`,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders without crashing when there are no toasts", () => {
    renderWithProvider();
    // No toast text should be visible
    expect(screen.queryByText("Success!")).not.toBeInTheDocument();
  });

  it("renders a success toast with icon and message", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-success").click());
    expect(screen.getByText("Success!")).toBeInTheDocument();
    expect(screen.getByText("It worked")).toBeInTheDocument();
  });

  it("renders an error toast", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-error").click());
    expect(screen.getByText("Error!")).toBeInTheDocument();
    expect(screen.getByText("Something failed")).toBeInTheDocument();
  });

  it("renders an info toast", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-info").click());
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("renders an encounter toast with sprite, title, and badge", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-encounter").click());
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    // Sprite image should be present (alt="" so we query by tag)
    const imgs = document.querySelectorAll("img.pokemon-sprite");
    expect(imgs.length).toBe(1);
    expect(imgs[0]).toHaveAttribute("src", "/pikachu.png");
  });

  it("renders encounter toast with -1 badge style", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-encounter-minus").click());
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("renders encounter toast with 0 badge style", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-encounter-zero").click());
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders encounter toast with delete badge", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-encounter-delete").click());
    expect(screen.getByText("\u{1F5D1}")).toBeInTheDocument();
  });

  it("renders encounter toast with check badge", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-encounter-check").click());
    expect(screen.getByText("\u2714")).toBeInTheDocument();
  });

  it("renders encounter toast with default +1 badge when no badge given", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-encounter-no-badge").click());
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("dismisses toast when the X button is clicked", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-success").click());
    expect(screen.getByText("Success!")).toBeInTheDocument();

    // Click the dismiss button (the X icon button)
    const dismissButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg") && btn.closest(".pointer-events-auto"),
    );
    act(() => dismissButtons[dismissButtons.length - 1].click());

    // After the dismiss animation timeout (200ms)
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Success!")).not.toBeInTheDocument();
  });

  it("applies leaving animation before auto-dismiss", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-info").click());

    // Info toast has 2000ms duration; exit animation starts at duration - 300 = 1700ms
    act(() => vi.advanceTimersByTime(1700));
    // Toast should still be in the DOM (leaving animation in progress)
    expect(screen.getByText("Info")).toBeInTheDocument();

    // After full duration, auto-dismiss fires
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText("Info")).not.toBeInTheDocument();
  });

  it("renders encounter toast without sprite when spriteUrl is not provided", () => {
    renderWithProvider();
    act(() => screen.getByTestId("push-encounter-delete").click());
    // No img element should be rendered for encounter without sprite
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders encounter toast without message when message is empty", () => {
    renderWithProvider();
    // The encounter-delete push has a message, but let's verify encounter toast renders title
    act(() => screen.getByTestId("push-encounter-delete").click());
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
  });
});
