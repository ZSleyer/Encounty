import { describe, it, expect } from "vitest";
import { render } from "../../test-utils";
import { makePokemon } from "../../test-utils";
import { DetectorPreview, DetectorPreviewProps } from "./DetectorPreview";
import { CaptureServiceProvider } from "../../contexts/CaptureServiceContext";
import { DetectorConfig } from "../../types";

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
    const previewSection = document.querySelector('[data-detector-tutorial="preview"]');
    expect(previewSection).toBeInTheDocument();
  });

  it("shows placeholder when no stream is available", () => {
    renderPreview();
    const previewSection = document.querySelector('[data-detector-tutorial="preview"]');
    expect(previewSection).toBeInTheDocument();
    // No <video> element should be rendered
    expect(previewSection?.querySelector("video")).toBeNull();
  });

  it("does not show confidence badge when not running", () => {
    renderPreview({ isRunning: false, confidence: 0.95 });
    // Confidence badge requires isRunning + stream + confidence > 0.01
    expect(document.querySelector('[data-detector-tutorial="preview"]')?.textContent).not.toContain("95.0%");
  });

  it("does not show detection log when no entries exist", () => {
    renderPreview({
      pokemon: makePokemon({ detector_config: makeDetectorConfig({ detection_log: [] }) }),
    });
    expect(document.querySelector('[data-detector-tutorial="preview"]')?.textContent).not.toContain("92.0%");
  });
});
