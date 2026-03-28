import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "../../test-utils";
import { TrimmedBoxSprite } from "./TrimmedBoxSprite";
import { SPRITE_FALLBACK } from "../../utils/sprites";

// Track Image instances created during tests
let imageInstances: Array<{
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  crossOrigin: string;
  width: number;
  height: number;
}>;

beforeEach(() => {
  imageInstances = [];
  vi.restoreAllMocks();

  // Mock Image as a class so `new Image()` works
  globalThis.Image = class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    crossOrigin = "";
    width = 2;
    height = 2;
    constructor() {
      imageInstances.push(this);
    }
  } as unknown as typeof Image;
});

// Mock canvas context for pixel analysis
function mockCanvasContext() {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      // 2x2 image with one opaque pixel at (1,0)
      data: new Uint8ClampedArray([
        0, 0, 0, 0,
        0, 0, 0, 255,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    }),
    set imageSmoothingEnabled(_: boolean) {},
  };

  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => "data:image/png;base64,fake",
      } as unknown as HTMLCanvasElement;
    }
    return origCreateElement(tag);
  });
  return ctx;
}

describe("TrimmedBoxSprite", () => {
  it("renders without crashing", async () => {
    mockCanvasContext();
    const { container } = render(
      <TrimmedBoxSprite canonicalName="bulbasaur" alt="Bulbasaur" />,
    );

    // The component creates an Image in useEffect
    expect(imageInstances.length).toBeGreaterThan(0);
    const img = imageInstances[0];
    await act(async () => {
      img.onload?.();
    });

    await waitFor(() => {
      const imgEl = container.querySelector("img");
      expect(imgEl).toBeInTheDocument();
    });
  });

  it("shows fallback on image load error", async () => {
    render(
      <TrimmedBoxSprite canonicalName="nonexistent" alt="Unknown" />,
    );

    expect(imageInstances.length).toBeGreaterThan(0);
    const img = imageInstances[0];
    await act(async () => {
      img.onerror?.();
    });

    await waitFor(() => {
      const imgEl = screen.getByAltText("Unknown");
      expect(imgEl).toHaveAttribute("src", SPRITE_FALLBACK);
    });
  });

  it("returns null when hideOnFail is true and image fails", async () => {
    const { container } = render(
      <TrimmedBoxSprite
        canonicalName="nonexistent"
        alt="Unknown"
        hideOnFail
      />,
    );

    expect(imageInstances.length).toBeGreaterThan(0);
    const img = imageInstances[0];
    await act(async () => {
      img.onerror?.();
    });

    await waitFor(() => {
      expect(container.querySelector("img")).toBeNull();
    });
  });
});
