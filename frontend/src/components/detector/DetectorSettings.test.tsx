import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import userEvent from "@testing-library/user-event";
import { DetectorSettings, DetectorSettingsProps } from "./DetectorSettings";
import { DetectorConfig, HuntTypePreset } from "../../types";

/** Minimal DetectorConfig fixture with sensible defaults. */
function makeDetectorConfig(overrides?: Partial<DetectorConfig>): DetectorConfig {
  return {
    enabled: false,
    source_type: "browser_display",
    region: { x: 0, y: 0, w: 1920, h: 1080 },
    window_title: "",
    templates: [],
    precision: 0.8,
    consecutive_hits: 1,
    cooldown_sec: 5,
    change_threshold: 0.15,
    poll_interval_ms: 50,
    min_poll_ms: 30,
    max_poll_ms: 500,
    ...overrides,
  };
}

/** Click the toggle button to expand the settings panel. */
async function expandSettings(user: ReturnType<typeof userEvent.setup>) {
  const settingsDiv = document.querySelector('[data-detector-tutorial="settings"]');
  if (!settingsDiv) throw new Error("settings div not found");
  // First button inside the settings div is the toggle
  const toggle = settingsDiv.querySelector("button");
  if (!toggle) throw new Error("toggle button not found");
  await user.click(toggle);
}

/** Helper to render DetectorSettings with default props. */
function renderSettings(overrides?: Partial<DetectorSettingsProps>) {
  const props: DetectorSettingsProps = {
    cfg: makeDetectorConfig(),
    onUpdate: vi.fn(),
    onSave: vi.fn(),
    onReset: vi.fn(),
    settingsDirty: false,
    ...overrides,
  };
  const result = render(<DetectorSettings {...props} />);
  return { ...result, props };
}

describe("DetectorSettings", () => {
  it("renders collapsed by default", () => {
    renderSettings();
    const settingsDiv = document.querySelector('[data-detector-tutorial="settings"]');
    expect(settingsDiv).toBeInTheDocument();
    // Precision slider should not be visible when collapsed
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("expands settings panel on toggle click", async () => {
    const user = userEvent.setup();
    renderSettings();
    await expandSettings(user);
    // After expanding, precision slider should be visible
    expect(document.getElementById("det-precision")).toBeInTheDocument();
  });

  it("shows correct precision percentage in expanded state", async () => {
    const user = userEvent.setup();
    renderSettings({
      cfg: makeDetectorConfig({ precision: 0.95 }),
    });
    await expandSettings(user);
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("calls onUpdate when precision slider changes", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const slider = document.getElementById("det-precision") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.9" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ precision: 0.9 });
  });

  it("calls onUpdate when cooldown input changes", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const cooldown = document.getElementById("det-cooldown") as HTMLInputElement;
    await user.clear(cooldown);
    await user.type(cooldown, "15");
    expect(props.onUpdate).toHaveBeenCalled();
  });

  it("calls onUpdate when consecutive hits input changes", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const hits = document.getElementById("det-hits") as HTMLInputElement;
    await user.clear(hits);
    await user.type(hits, "5");
    expect(props.onUpdate).toHaveBeenCalled();
  });

  it("shows save button disabled when settings are not dirty", async () => {
    const user = userEvent.setup();
    renderSettings({ settingsDirty: false });
    await expandSettings(user);
    // Save button contains an SVG icon from Save lucide-react component
    const buttons = screen.getAllByRole("button");
    // Last button in the expanded panel is the save button
    const saveBtn = buttons[buttons.length - 1];
    expect(saveBtn).toBeDisabled();
  });

  it("shows save button enabled when settings are dirty", async () => {
    const user = userEvent.setup();
    renderSettings({ settingsDirty: true });
    await expandSettings(user);
    const buttons = screen.getAllByRole("button");
    const saveBtn = buttons[buttons.length - 1];
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls onSave when save button is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings({ settingsDirty: true });
    await expandSettings(user);
    const buttons = screen.getAllByRole("button");
    const saveBtn = buttons[buttons.length - 1];
    await user.click(saveBtn);
    expect(props.onSave).toHaveBeenCalledOnce();
  });

  it("calls onReset when reset button is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const buttons = screen.getAllByRole("button");
    // Reset button is second-to-last (before save)
    const resetBtn = buttons[buttons.length - 2];
    await user.click(resetBtn);
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  it("shows hunt type preset info when activePreset is provided", async () => {
    const user = userEvent.setup();
    const preset: HuntTypePreset = {
      key: "masuda",
      name_de: "Masuda",
      name_en: "Masuda",
      odds_numer: 1,
      odds_denom: 683,
      default_cooldown_sec: 5,
      default_consecutive_hits: 2,
      template_tip: "Use egg sprite",
    };
    renderSettings({ activePreset: preset, onApplyDefaults: vi.fn() });
    await expandSettings(user);
    expect(screen.getByText(/683/)).toBeInTheDocument();
  });

  it("calls onApplyDefaults when apply defaults button is clicked", async () => {
    const user = userEvent.setup();
    const onApplyDefaults = vi.fn();
    const preset: HuntTypePreset = {
      key: "masuda",
      name_de: "Masuda",
      name_en: "Masuda",
      odds_numer: 1,
      odds_denom: 683,
      default_cooldown_sec: 5,
      default_consecutive_hits: 2,
      template_tip: "Use egg sprite",
    };
    renderSettings({ activePreset: preset, onApplyDefaults });
    await expandSettings(user);
    // The "apply defaults" button contains odds text nearby
    const oddsText = screen.getByText(/1 \/ 683/);
    // The apply button is a sibling
    const applyBtn = oddsText.closest("div")!.querySelector("button")!;
    await user.click(applyBtn);
    expect(onApplyDefaults).toHaveBeenCalledOnce();
  });

  it("does not show preset section when activePreset is undefined", async () => {
    const user = userEvent.setup();
    renderSettings({ activePreset: undefined });
    await expandSettings(user);
    expect(screen.queryByText(/683/)).not.toBeInTheDocument();
  });

  it("renders polling interval inputs in expanded state", async () => {
    const user = userEvent.setup();
    renderSettings();
    await expandSettings(user);
    expect(document.getElementById("det-base-poll")).toBeInTheDocument();
    expect(document.getElementById("det-min-poll")).toBeInTheDocument();
    expect(document.getElementById("det-max-poll")).toBeInTheDocument();
  });

  it("calls onUpdate when base poll input changes", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const basePoll = document.getElementById("det-base-poll") as HTMLInputElement;
    fireEvent.change(basePoll, { target: { value: "100" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ poll_interval_ms: 100 });
  });

  it("calls onUpdate when min poll input changes", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const minPoll = document.getElementById("det-min-poll") as HTMLInputElement;
    fireEvent.change(minPoll, { target: { value: "20" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ min_poll_ms: 20 });
  });

  it("calls onUpdate when max poll input changes", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const maxPoll = document.getElementById("det-max-poll") as HTMLInputElement;
    fireEvent.change(maxPoll, { target: { value: "1000" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ max_poll_ms: 1000 });
  });

  it("calls onUpdate when hysteresis slider changes", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const hysteresis = document.getElementById("det-hysteresis") as HTMLInputElement;
    fireEvent.change(hysteresis, { target: { value: "0.85" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ hysteresis_factor: 0.85 });
  });

  it("uses NaN fallback of 50 for base poll when input is cleared", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const basePoll = document.getElementById("det-base-poll") as HTMLInputElement;
    fireEvent.change(basePoll, { target: { value: "" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ poll_interval_ms: 50 });
  });

  it("uses NaN fallback of 30 for min poll when input is cleared", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const minPoll = document.getElementById("det-min-poll") as HTMLInputElement;
    fireEvent.change(minPoll, { target: { value: "" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ min_poll_ms: 30 });
  });

  it("uses NaN fallback of 500 for max poll when input is cleared", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await expandSettings(user);
    const maxPoll = document.getElementById("det-max-poll") as HTMLInputElement;
    fireEvent.change(maxPoll, { target: { value: "" } });
    expect(props.onUpdate).toHaveBeenCalledWith({ max_poll_ms: 500 });
  });

  it("renders settings content directly when embedded is true", () => {
    renderSettings({ embedded: true });
    // Settings should be visible without clicking toggle
    expect(document.getElementById("det-precision")).toBeInTheDocument();
    expect(document.getElementById("det-base-poll")).toBeInTheDocument();
  });

  it("sets aria-disabled when disabled is true in embedded mode", () => {
    const { container } = renderSettings({ embedded: true, disabled: true });
    const settingsDiv = container.querySelector("[aria-disabled]");
    expect(settingsDiv).toBeInTheDocument();
    expect(settingsDiv).toHaveAttribute("aria-disabled", "true");
  });

});
