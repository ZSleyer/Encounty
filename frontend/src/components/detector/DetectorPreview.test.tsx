import { describe, it, expect, vi } from "vitest";
import { render, screen, makePokemon } from "../../test-utils";
import userEvent from "@testing-library/user-event";
import { DetectorPreview, DetectorPreviewProps } from "./DetectorPreview";
import { CaptureServiceProvider } from "../../contexts/CaptureServiceContext";
import { DetectorConfig, DetectionLogEntry } from "../../types";

/** Minimal DetectorConfig fixture. */
function makeDetectorConfig(overrides?: Partial<DetectorConfig>): DetectorConfig {
  return {
    enabled: false,
    source_type: "browser_display",
    region: { x: 0, y: 0, w: 1920, h: 1080 },
    window_title: "",
    templates: [],
    precision: 0.8,
    consecutive_hits: 1,
    cooldown_sec: 8,
    change_threshold: 0.15,
    poll_interval_ms: 50,
    min_poll_ms: 30,
    max_poll_ms: 500,
    ...overrides,
  };
}

/** Helper to render DetectorPreview wrapped in CaptureServiceProvider. */
function renderPreview(overrides?: Partial<DetectorPreviewProps>) {
  const props: DetectorPreviewProps = {
    pokemon: makePokemon(),
    cfg: makeDetectorConfig(),
    onSourceTypeChange: vi.fn(),
    onStartCapture: vi.fn(),
    onStopCapture: vi.fn(),
    isRunning: false,
    confidence: 0,
    ...overrides,
  };
  const result = render(
    <CaptureServiceProvider>
      <DetectorPreview {...props} />
    </CaptureServiceProvider>,
  );
  return { ...result, props };
}

describe("DetectorPreview", () => {
  it("renders without crashing", () => {
    renderPreview();
    // Source header area should be present (uses data-detector-tutorial="source")
    const sourceSection = document.querySelector('[data-detector-tutorial="source"]');
    expect(sourceSection).toBeInTheDocument();
  });

  it("shows placeholder when no stream is available", () => {
    renderPreview();
    // Placeholder area is the preview div with a Camera icon and text
    const previewSection = document.querySelector('[data-detector-tutorial="preview"]');
    expect(previewSection).toBeInTheDocument();
    // No <video> element should be rendered
    expect(previewSection?.querySelector("video")).toBeNull();
  });

  it("shows connect button when no stream is active", () => {
    renderPreview();
    // Only one button when not connected
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
  });

  it("calls onStartCapture when connect button is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderPreview();
    const connectBtn = screen.getByRole("button");
    await user.click(connectBtn);
    expect(props.onStartCapture).toHaveBeenCalledOnce();
  });

  it("renders source type selector with correct value", () => {
    renderPreview({
      cfg: makeDetectorConfig({ source_type: "browser_display" }),
    });
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("browser_display");
  });

  it("calls onSourceTypeChange when source type is changed", async () => {
    const user = userEvent.setup();
    const { props } = renderPreview();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "browser_camera");
    expect(props.onSourceTypeChange).toHaveBeenCalledWith("browser_camera");
  });

  it("does not show confidence badge when not running", () => {
    renderPreview({ isRunning: false, confidence: 0.95 });
    // Confidence badge requires isRunning + stream + confidence > 0.01
    expect(screen.queryByText(/95\.0%/)).not.toBeInTheDocument();
  });

  it("does not show detection log when no entries exist", () => {
    renderPreview({
      pokemon: makePokemon({ detector_config: makeDetectorConfig({ detection_log: [] }) }),
    });
    // No log section should be rendered
    // The only font-mono elements should be from the combobox area, not log entries
    expect(screen.queryByText(/92\.0%/)).not.toBeInTheDocument();
  });

  it("renders detection log entries when present", () => {
    const logEntries: DetectionLogEntry[] = [
      { at: "2024-06-01T12:00:00Z", confidence: 0.92 },
      { at: "2024-06-01T12:01:00Z", confidence: 0.88 },
    ];
    renderPreview({
      pokemon: makePokemon({
        detector_config: makeDetectorConfig({ detection_log: logEntries }),
      }),
    });
    expect(screen.getByText("92.0%")).toBeInTheDocument();
    expect(screen.getByText("88.0%")).toBeInTheDocument();
  });

  it("renders with browser_camera source type selected", () => {
    renderPreview({
      cfg: makeDetectorConfig({ source_type: "browser_camera" }),
    });
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("browser_camera");
  });
});
