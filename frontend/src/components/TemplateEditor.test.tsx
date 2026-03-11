import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "../test-utils";
import { TemplateEditor } from "./TemplateEditor";

// Mock useOCR since it uses tesseract.js which is heavy
vi.mock("../hooks/useOCR", () => ({
  useOCR: () => ({
    recognize: vi.fn(),
    isRecognizing: false,
    ocrError: null,
  }),
}));

// HTMLVideoElement.play is not implemented in jsdom
beforeAll(() => {
  HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());
});

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

  it("renders in video mode when stream is provided", () => {
    // Create a minimal fake MediaStream
    const fakeStream = {
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
      addTrack: vi.fn(),
      removeTrack: vi.fn(),
      active: true,
    } as unknown as MediaStream;

    render(
      <TemplateEditor
        stream={fakeStream}
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
