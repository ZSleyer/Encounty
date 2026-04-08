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
    width = 4;
    height = 4;
    constructor() {
      imageInstances.push(this);
    }
  } as unknown as typeof Image;
});

/**
 * Mock canvas context for pixel analysis.
 * @param pixelData Custom pixel data array (RGBA). Defaults to a 4x4 image with opaque content.
 * @param options Additional context/canvas overrides.
 */
function mockCanvasContext(
  pixelData?: Uint8ClampedArray,
  options?: { ctxReturnsNull?: boolean; toDataURLReturns?: string },
) {
  const data =
    pixelData ??
    new Uint8ClampedArray([
      // 4x4 image with content at (1,1) and (2,2)
      0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,
      0, 0, 0, 0,   255, 0, 0, 255,  0, 0, 0, 0,   0, 0, 0, 0,
      0, 0, 0, 0,   0, 0, 0, 0,   0, 255, 0, 255,  0, 0, 0, 0,
      0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,
    ]);

  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data }),
    set imageSmoothingEnabled(_: boolean) {},
  };

  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => (options?.ctxReturnsNull ? null : ctx),
        toDataURL: () => options?.toDataURLReturns ?? "data:image/png;base64,trimmed",
      } as unknown as HTMLCanvasElement;
    }
    return origCreateElement(tag);
  });
  return ctx;
}

describe("TrimmedBoxSprite", () => {
  it("renders trimmed sprite on successful load with content", async () => {
    mockCanvasContext();
    const { container } = render(
      <TrimmedBoxSprite canonicalName="bulbasaur" alt="Bulbasaur" />,
    );

    expect(imageInstances.length).toBeGreaterThan(0);
    const img = imageInstances[0];
    await act(async () => {
      img.onload?.();
    });

    await waitFor(() => {
      const imgEl = container.querySelector("img");
      expect(imgEl).toBeInTheDocument();
      expect(imgEl?.getAttribute("src")).toBe("data:image/png;base64,trimmed");
      expect(imgEl?.getAttribute("alt")).toBe("Bulbasaur");
    });
  });

  it("applies pokemon-sprite and pixelated classes", async () => {
    mockCanvasContext();
    const { container } = render(
      <TrimmedBoxSprite canonicalName="charmander" alt="Charmander" />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onload?.();
    });

    await waitFor(() => {
      const imgEl = container.querySelector("img");
      expect(imgEl?.className).toContain("pokemon-sprite");
      expect(imgEl?.className).toContain("[image-rendering:pixelated]");
    });
  });

  it("applies custom className", async () => {
    mockCanvasContext();
    const { container } = render(
      <TrimmedBoxSprite canonicalName="squirtle" alt="Squirtle" className="w-8 h-8" />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onload?.();
    });

    await waitFor(() => {
      const imgEl = container.querySelector("img");
      expect(imgEl?.className).toContain("w-8 h-8");
    });
  });

  it("shows fallback on image load error", async () => {
    render(
      <TrimmedBoxSprite canonicalName="nonexistent" alt="Unknown" />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onerror?.();
    });

    await waitFor(() => {
      const imgEl = screen.getByAltText("Unknown");
      expect(imgEl).toHaveAttribute("src", SPRITE_FALLBACK);
    });
  });

  it("fallback image has pokemon-sprite class", async () => {
    render(
      <TrimmedBoxSprite canonicalName="nonexistent" alt="Unknown" />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onerror?.();
    });

    await waitFor(() => {
      const imgEl = screen.getByAltText("Unknown");
      expect(imgEl.className).toContain("pokemon-sprite");
    });
  });

  it("renders fallbackSrc when image load fails and fallbackSrc is provided", async () => {
    render(
      <TrimmedBoxSprite
        canonicalName="nonexistent"
        alt="Unknown"
        fallbackSrc="https://example.com/fallback.png"
      />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onerror?.();
    });

    await waitFor(() => {
      const imgEl = screen.getByAltText("Unknown");
      expect(imgEl).toHaveAttribute("src", "https://example.com/fallback.png");
    });
  });

  it("fallbackSrc takes precedence over hideOnFail", async () => {
    render(
      <TrimmedBoxSprite
        canonicalName="nonexistent"
        alt="Unknown"
        hideOnFail
        fallbackSrc="https://example.com/fallback.png"
      />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onerror?.();
    });

    await waitFor(() => {
      const imgEl = screen.getByAltText("Unknown");
      expect(imgEl).toHaveAttribute("src", "https://example.com/fallback.png");
    });
  });

  it("returns null when hideOnFail is true and image fails", async () => {
    const { container } = render(
      <TrimmedBoxSprite canonicalName="nonexistent" alt="Unknown" hideOnFail />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onerror?.();
    });

    await waitFor(() => {
      expect(container.querySelector("img")).toBeNull();
    });
  });

  it("shows fallback when image is fully transparent (no content bounds)", async () => {
    // All alpha values are 0 (fully transparent)
    const transparentData = new Uint8ClampedArray(4 * 4 * 4); // 4x4, all zeros
    mockCanvasContext(transparentData);

    render(
      <TrimmedBoxSprite canonicalName="transparent-test" alt="Transparent" />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onload?.();
    });

    await waitFor(() => {
      const imgEl = screen.getByAltText("Transparent");
      expect(imgEl).toHaveAttribute("src", SPRITE_FALLBACK);
    });
  });

  it("returns null when hideOnFail is true and image is fully transparent", async () => {
    const transparentData = new Uint8ClampedArray(4 * 4 * 4);
    mockCanvasContext(transparentData);

    const { container } = render(
      <TrimmedBoxSprite canonicalName="transparent-test" alt="Transparent" hideOnFail />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onload?.();
    });

    await waitFor(() => {
      expect(container.querySelector("img")).toBeNull();
    });
  });

  it("shows fallback when canvas context is null (drawTrimmedSprite fails)", async () => {
    mockCanvasContext(undefined, { ctxReturnsNull: true });

    render(
      <TrimmedBoxSprite canonicalName="no-ctx" alt="NoCtx" />,
    );

    const img = imageInstances[0];
    await act(async () => {
      img.onload?.();
    });

    await waitFor(() => {
      const imgEl = screen.getByAltText("NoCtx");
      expect(imgEl).toHaveAttribute("src", SPRITE_FALLBACK);
    });
  });

  it("uses normal sprite type when specified", async () => {
    mockCanvasContext();
    render(
      <TrimmedBoxSprite canonicalName="pikachu" spriteType="normal" alt="Pikachu" />,
    );

    const img = imageInstances[0];
    expect(img.src).toContain("/regular/pikachu.png");

    await act(async () => {
      img.onload?.();
    });
  });

  it("uses shiny sprite type by default", async () => {
    mockCanvasContext();
    render(
      <TrimmedBoxSprite canonicalName="pikachu" alt="Pikachu" />,
    );

    const img = imageInstances[0];
    expect(img.src).toContain("/shiny/pikachu.png");

    await act(async () => {
      img.onload?.();
    });
  });

  it("sets crossOrigin to anonymous", async () => {
    mockCanvasContext();
    render(
      <TrimmedBoxSprite canonicalName="eevee" alt="Eevee" />,
    );

    const img = imageInstances[0];
    expect(img.crossOrigin).toBe("anonymous");

    await act(async () => {
      img.onload?.();
    });
  });

  it("resets state when canonicalName changes", async () => {
    mockCanvasContext();
    const { rerender } = render(
      <TrimmedBoxSprite canonicalName="bulbasaur" alt="Sprite" />,
    );

    const firstImg = imageInstances[0];
    await act(async () => {
      firstImg.onload?.();
    });

    // Re-render with a different canonical name
    rerender(
      <TrimmedBoxSprite canonicalName="charmander" alt="Sprite" />,
    );

    // A new Image instance should have been created
    expect(imageInstances.length).toBeGreaterThan(1);
    const secondImg = imageInstances[imageInstances.length - 1];
    expect(secondImg.src).toContain("charmander");
  });

  it("returns null before image has loaded", () => {
    mockCanvasContext();
    const { container } = render(
      <TrimmedBoxSprite canonicalName="slowpoke" alt="Slowpoke" />,
    );

    // Before onload fires, no img element should be rendered
    expect(container.querySelector("img")).toBeNull();
  });
});
