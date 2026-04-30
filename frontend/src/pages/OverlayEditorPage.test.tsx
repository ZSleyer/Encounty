import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, makeAppState, waitFor, userEvent, act } from "../test-utils";
import { render as rawRender } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Link } from "react-router";
import { OverlayEditorPage } from "./OverlayEditorPage";
import { useCounterStore } from "../hooks/useCounterState";
import { ThemeProvider } from "../contexts/ThemeContext";
import { I18nProvider } from "../contexts/I18nContext";
import { ToastProvider } from "../contexts/ToastContext";
import { CaptureServiceProvider } from "../contexts/CaptureServiceContext";

const fetchMock = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  }),
);

vi.stubGlobal("fetch", fetchMock);

vi.mock("../components/overlay-editor/OverlayEditor", () => ({
  OverlayEditor: ({ onUpdate, settings }: { onUpdate: (s: unknown) => void; settings: unknown }) => (
    <div data-testid="overlay-editor">
      <button
        data-testid="trigger-change"
        onClick={() => onUpdate({ ...(settings as object), canvas_width: 800 })}
      >
        Change
      </button>
    </div>
  ),
}));

vi.mock("../utils/overlay", () => ({
  resolveOverlay: (_p: unknown, _all: unknown, settings: unknown) => settings,
  wouldCreateCircularLink: () => false,
}));

/**
 * Link component used to trigger navigation away from the editor page,
 * allowing the useBlocker hook to fire.
 */
function NavTrigger() {
  return (
    <Link to="/other" data-testid="nav-away">
      Go away
    </Link>
  );
}

/**
 * Renders OverlayEditorPage inside a multi-route memory router so that
 * navigating to "/other" triggers the useBlocker confirmation modal.
 */
function renderForBlocker() {
  const router = createMemoryRouter(
    [
      {
        path: "/editor",
        element: (
          <ThemeProvider>
            <I18nProvider>
              <CaptureServiceProvider>
                <ToastProvider>
                  <OverlayEditorPage />
                  <NavTrigger />
                </ToastProvider>
              </CaptureServiceProvider>
            </I18nProvider>
          </ThemeProvider>
        ),
      },
      { path: "/other", element: <div data-testid="other-page">Other</div> },
    ],
    { initialEntries: ["/editor"] },
  );
  return rawRender(<RouterProvider router={router} />);
}

describe("OverlayEditorPage", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing when state is available", () => {
    const { container } = render(<OverlayEditorPage />);
    expect(container).toBeTruthy();
  });

  it("shows loading spinner when no app state", () => {
    useCounterStore.setState({ appState: null });
    const { container } = render(<OverlayEditorPage />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows connecting text when no app state", () => {
    useCounterStore.setState({ appState: null });
    render(<OverlayEditorPage />);
    expect(screen.getByText("Verbinde\u2026")).toBeInTheDocument();
  });

  it("renders save button in disabled state initially", () => {
    render(<OverlayEditorPage />);
    const saveBtn = screen.getByLabelText("Overlay speichern");
    expect(saveBtn).toBeDisabled();
  });

  it("renders the default layout title", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByText("Standard-Layout")).toBeInTheDocument();
  });

  it("renders hotkeys paused badge", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByText("Hotkeys pausiert")).toBeInTheDocument();
  });

  it("renders OBS browser source button in header", () => {
    render(<OverlayEditorPage />);
    // Button has aria-haspopup="menu" for the dropdown chevron
    const chevron = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "menu");
    expect(chevron).toBeInTheDocument();
  });

  it("pauses hotkeys on mount", () => {
    render(<OverlayEditorPage />);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/pause"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resumes hotkeys on unmount", () => {
    const { unmount } = render(<OverlayEditorPage />);
    fetchMock.mockClear();
    unmount();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/hotkeys/resume"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders main content area with correct id", () => {
    render(<OverlayEditorPage />);
    const main = document.getElementById("main-content");
    expect(main).toBeInTheDocument();
  });

  it("enables save button after overlay change", async () => {
    const user = userEvent.setup();
    render(<OverlayEditorPage />);

    const saveBtn = screen.getByLabelText("Overlay speichern");
    expect(saveBtn).toBeDisabled();

    await user.click(screen.getByTestId("trigger-change"));

    expect(saveBtn).not.toBeDisabled();
  });

  it("saves overlay and shows saved indicator", async () => {
    const user = userEvent.setup();
    render(<OverlayEditorPage />);

    // Trigger a change to enable the save button
    await user.click(screen.getByTestId("trigger-change"));

    const saveBtn = screen.getByLabelText("Overlay speichern");
    expect(saveBtn).not.toBeDisabled();

    fetchMock.mockClear();
    await user.click(saveBtn);

    // Should have called PUT /api/settings
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/settings"),
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      }),
    );

    // "Gespeichert" indicator should appear
    await waitFor(() => {
      expect(screen.getByText("Gespeichert")).toBeInTheDocument();
    });

    // Save button should be disabled again after saving
    expect(saveBtn).toBeDisabled();
  });

  it("disables save button while saving (overlaySaving state)", async () => {
    // Make fetch hang so we can check the button during save
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveFetch: (v: any) => void;
    fetchMock.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<OverlayEditorPage />);

    await user.click(screen.getByTestId("trigger-change"));

    const saveBtn = screen.getByLabelText("Overlay speichern");

    // Clear the mock after the hotkey pause call
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    await user.click(saveBtn);

    // During save, button should be disabled
    expect(saveBtn).toBeDisabled();

    // Resolve the fetch
    resolveFetch!({ ok: true, json: () => Promise.resolve({}) });

    await waitFor(() => {
      // After save completes, button should still be disabled (no longer dirty)
      expect(saveBtn).toBeDisabled();
    });
  });

  it("handles save error gracefully", async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<OverlayEditorPage />);

    await user.click(screen.getByTestId("trigger-change"));

    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("Network error")));

    const saveBtn = screen.getByLabelText("Overlay speichern");
    await user.click(saveBtn);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it("renders the OverlayEditor component", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByTestId("overlay-editor")).toBeInTheDocument();
  });

  it("save button text is visible", () => {
    render(<OverlayEditorPage />);
    expect(screen.getByText("Overlay speichern")).toBeInTheDocument();
  });
});

/** Dirty the overlay and attempt to navigate away so the blocker fires. */
async function dirtyAndNavigate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("trigger-change"));
  await user.click(screen.getByTestId("nav-away"));
}

describe("OverlayEditorPage — unsaved changes modal", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    useCounterStore.setState({
      appState: makeAppState(),
      isConnected: true,
      lastEncounterPokemonId: null,
      detectorStatus: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the unsaved changes modal when navigating with dirty state", async () => {
    const user = userEvent.setup();
    renderForBlocker();

    await dirtyAndNavigate(user);

    expect(screen.getByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    expect(
      screen.getByText("Du hast Änderungen am Overlay, die noch nicht gespeichert wurden."),
    ).toBeInTheDocument();
    expect(screen.getByText("Zurück zum Editor")).toBeInTheDocument();
    expect(screen.getByText("Verwerfen")).toBeInTheDocument();
  });

  it("does not show the modal when navigating without changes", async () => {
    const user = userEvent.setup();
    renderForBlocker();

    await user.click(screen.getByTestId("nav-away"));

    // Should have navigated away — editor should be gone
    expect(screen.queryByTestId("overlay-editor")).not.toBeInTheDocument();
    expect(screen.queryByText("Ungespeicherte Änderungen")).not.toBeInTheDocument();
  });

  it("stays on editor when clicking the stay button", async () => {
    const user = userEvent.setup();
    renderForBlocker();

    await dirtyAndNavigate(user);

    await user.click(screen.getByText("Zurück zum Editor"));

    // Modal should close
    expect(screen.queryByText("Ungespeicherte Änderungen")).not.toBeInTheDocument();
    // Editor should still be visible
    expect(screen.getByTestId("overlay-editor")).toBeInTheDocument();
  });

  it("navigates away when clicking the discard button", async () => {
    const user = userEvent.setup();
    renderForBlocker();

    await dirtyAndNavigate(user);

    await user.click(screen.getByText("Verwerfen"));

    // Should have navigated to the other page
    await waitFor(() => {
      expect(screen.getByTestId("other-page")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("overlay-editor")).not.toBeInTheDocument();
  });

  it("closes the modal when clicking the backdrop", async () => {
    const user = userEvent.setup();
    renderForBlocker();

    await dirtyAndNavigate(user);

    // The backdrop is the outermost fixed div containing the modal
    const backdrop = screen.getByText("Ungespeicherte Änderungen").closest(
      ".fixed",
    ) as HTMLElement;
    expect(backdrop).toBeTruthy();

    // Click directly on the backdrop (not on child elements)
    await user.click(backdrop);

    // Modal should close, editor should remain
    expect(screen.queryByText("Ungespeicherte Änderungen")).not.toBeInTheDocument();
    expect(screen.getByTestId("overlay-editor")).toBeInTheDocument();
  });

  it("closes the modal when pressing Escape on the backdrop", async () => {
    const user = userEvent.setup();
    renderForBlocker();

    await dirtyAndNavigate(user);

    await waitFor(() => {
      expect(screen.getByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    });

    // Dispatch a native keyDown event on the backdrop element
    const backdrop = screen.getByText("Ungespeicherte Änderungen").closest(
      ".fixed",
    ) as HTMLElement;
    act(() => { backdrop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

    // Modal should close, editor should remain
    await waitFor(() => {
      expect(screen.queryByText("Ungespeicherte Änderungen")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("overlay-editor")).toBeInTheDocument();
  });
});
