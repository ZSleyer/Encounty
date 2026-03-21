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

  it("renders in new-template mode with pokemonId", () => {
    render(
      <TemplateEditor
        pokemonId="poke-1"
        onClose={vi.fn()}
        onSaveTemplate={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
