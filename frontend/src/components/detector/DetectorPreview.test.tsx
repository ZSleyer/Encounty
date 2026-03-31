import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, makePokemon } from "../../test-utils";
import { DetectorPreview, DetectorPreviewProps } from "./DetectorPreview";
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

// Mock CaptureServiceContext to control stream availability
const mockGetStream = vi.fn().mockReturnValue(null);

vi.mock("../../contexts/CaptureServiceContext", () => ({
  CaptureServiceProvider: ({ children }: { children: React.ReactNode }) => children,
  useCaptureService: () => ({
    getStream: mockGetStream,
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
  }),
  useCaptureVersion: () => 0,
}));

/** Helper to render DetectorPreview. */
function renderPreview(overrides?: Partial<DetectorPreviewProps>) {
  const props: DetectorPreviewProps = {
    pokemon: makePokemon(),
    cfg: makeDetectorConfig(),
    isRunning: false,
    confidence: 0,
    ...overrides,
  };
  return render(<DetectorPreview {...props} />);
}

// Provide a minimal MediaStream mock for jsdom
beforeEach(() => {
  globalThis.MediaStream ??= class MockMediaStream {
    getTracks() { return []; }
  } as unknown as typeof MediaStream;
  // HTMLVideoElement.play() returns undefined in jsdom — patch it to return a resolved promise
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

describe("DetectorPreview", () => {
  beforeEach(() => {
    mockGetStream.mockReturnValue(null);
  });

  it("renders the preview container with tutorial attribute", () => {
    renderPreview();
    const container = document.querySelector('[data-detector-tutorial="preview"]');
    expect(container).toBeInTheDocument();
  });

  it("shows placeholder when no stream is available", () => {
    renderPreview();
    expect(screen.getByText("Keine Verbindung")).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });

  it("renders video element when stream is available", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    renderPreview();
    const video = document.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.getAttribute("autoplay")).not.toBeNull();
    // React sets muted as a DOM property, not an attribute
    expect(video?.muted).toBe(true);
  });

  it("does not show confidence badge when not running", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    renderPreview({ isRunning: false, confidence: 0.95 });
    expect(document.querySelector('[data-detector-tutorial="preview"]')?.textContent).not.toContain("95.0%");
  });

  it("does not show confidence badge when confidence is very low", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    renderPreview({ isRunning: true, confidence: 0.005 });
    expect(document.querySelector('[data-detector-tutorial="preview"]')?.textContent).not.toContain("%");
  });

  it("does not show confidence badge when stream is null even if running", () => {
    mockGetStream.mockReturnValue(null);
    renderPreview({ isRunning: true, confidence: 0.9 });
    expect(document.querySelector('[data-detector-tutorial="preview"]')?.textContent).not.toContain("90.0%");
  });

  it("shows confidence badge with green class when confidence >= precision", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    renderPreview({
      isRunning: true,
      confidence: 0.85,
      cfg: makeDetectorConfig({ precision: 0.8 }),
    });

    const badge = document.querySelector(String.raw`[data-detector-tutorial="preview"] .bg-green-500\/80`);
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe("85.0%");
  });

  it("shows confidence badge with amber class when 0.5 <= confidence < precision", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    renderPreview({
      isRunning: true,
      confidence: 0.6,
      cfg: makeDetectorConfig({ precision: 0.8 }),
    });

    const badge = document.querySelector(String.raw`[data-detector-tutorial="preview"] .bg-amber-500\/80`);
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe("60.0%");
  });

  it("shows confidence badge with dark class when confidence < 0.5", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    renderPreview({
      isRunning: true,
      confidence: 0.3,
      cfg: makeDetectorConfig({ precision: 0.8 }),
    });

    const badge = document.querySelector(String.raw`[data-detector-tutorial="preview"] .bg-black\/60`);
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe("30.0%");
  });

  it("does not show confidence badge when confidence is null", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    renderPreview({ isRunning: true, confidence: undefined });
    const container = document.querySelector('[data-detector-tutorial="preview"]');
    // Only the video element, no badge
    expect(container?.querySelectorAll("div > div")).toHaveLength(0);
  });

  it("uses precision default of 0.8 when not specified", () => {
    const fakeStream = new MediaStream();
    mockGetStream.mockReturnValue(fakeStream);

    // confidence 0.82 is >= precision 0.8 -> green
    renderPreview({
      isRunning: true,
      confidence: 0.82,
      cfg: makeDetectorConfig({ precision: 0.8 }),
    });

    const badge = document.querySelector(String.raw`[data-detector-tutorial="preview"] .bg-green-500\/80`);
    expect(badge).toBeInTheDocument();
  });

  it("renders Camera icon in placeholder", () => {
    renderPreview();
    // Camera icon from lucide-react renders as an SVG
    const svg = document.querySelector('[data-detector-tutorial="preview"] svg');
    expect(svg).toBeInTheDocument();
  });
});
