import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { TemplateEditor } from "./TemplateEditor";

// Mock useOCR since it uses tesseract.js which is heavy
vi.mock("../../hooks/useOCR", () => ({
  useOCR: () => ({
    recognize: vi.fn(),
    isRecognizing: false,
    ocrError: null,
  }),
}));

// Mock useReplayBuffer since it requires a real video element
vi.mock("../../hooks/useReplayBuffer", () => ({
  useReplayBuffer: () => ({
    frames: [],
    frameCount: 0,
    getFrame: () => null,
    isBuffering: false,
    bufferedSeconds: 0,
    clear: vi.fn(),
    stop: vi.fn(),
  }),
}));

describe("TemplateEditor", () => {
  it("renders in edit mode with an initial image URL", () => {
    render(
      <TemplateEditor
        initialImageUrl="/api/detector/poke-1/template/0"
        onClose={vi.fn()}
        onUpdateRegions={vi.fn()}
      />,
    );
    // Should render the close button
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders in new-template mode with stream", () => {
    render(
      <TemplateEditor
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
