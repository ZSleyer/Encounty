/**
 * useRawPreview — Streams raw RGBA frames from the sidecar and renders them
 * on a canvas using the WebCodecs VideoFrame API for GPU-backed display.
 *
 * Protocol: HTTP binary stream with 8-byte frame headers:
 *   [width:u16 LE][height:u16 LE][length:u32 LE][rgba_data]
 *
 * Falls back to canvas putImageData when VideoFrame is unavailable.
 */
import { type RefObject, useEffect, useRef, useState } from 'react'

/** Whether the browser supports the WebCodecs VideoFrame constructor. */
const HAS_VIDEO_FRAME = typeof VideoFrame !== 'undefined'

/** Size of the binary frame header: u16 width + u16 height + u32 length. */
const HEADER_SIZE = 8

/**
 * Hook that consumes a raw RGBA-over-HTTP stream and renders frames to a
 * canvas element. Prefers the GPU-backed VideoFrame API when available,
 * otherwise falls back to ImageData/putImageData.
 *
 * @param url  Full stream URL, or null to disable streaming.
 * @param canvasRef  Ref to the target canvas element.
 * @returns `fps` (frames rendered per second) and `active` (true once frames flow).
 */
export function useRawPreview(
  url: string | null,
  canvasRef: RefObject<HTMLCanvasElement | null>,
): { fps: number; active: boolean } {
  const [fps, setFps] = useState(0)
  const [active, setActive] = useState(false)
  const frameCountRef = useRef(0)

  useEffect(() => {
    if (!url) return

    const controller = new AbortController()
    let activated = false

    const startStream = async () => {
      let resp: Response
      try {
        resp = await fetch(url, { signal: controller.signal })
      } catch {
        return
      }

      if (!resp.body) return
      const reader = resp.body.getReader()

      // Accumulation buffer for partial reads
      let buf = new Uint8Array(0)

      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>
        try {
          result = await reader.read()
        } catch {
          break
        }
        if (result.done) break

        // Append incoming chunk to buffer — always copy into a fresh
        // ArrayBuffer so slicing later yields a proper ArrayBuffer (not
        // ArrayBufferLike which breaks Uint8ClampedArray construction).
        const chunk = result.value
        if (buf.length === 0) {
          const copy = new Uint8Array(chunk.length)
          copy.set(chunk)
          buf = copy
        } else {
          const next = new Uint8Array(buf.length + chunk.length)
          next.set(buf)
          next.set(chunk, buf.length)
          buf = next
        }

        // Extract as many complete frames as possible
        while (buf.length >= HEADER_SIZE) {
          const width = buf[0] | (buf[1] << 8)
          const height = buf[2] | (buf[3] << 8)
          const length = buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24)

          const frameEnd = HEADER_SIZE + length
          if (buf.length < frameEnd) break

          const rgbaSlice = buf.slice(HEADER_SIZE, frameEnd)
          const rgbaData = new Uint8ClampedArray(
            rgbaSlice.buffer as ArrayBuffer,
          )

          renderFrame(canvasRef.current, rgbaData, width, height)
          frameCountRef.current++

          if (!activated) {
            activated = true
            setActive(true)
          }

          // Advance past the consumed frame
          buf = buf.subarray(frameEnd)
        }
      }
    }

    startStream().catch(() => {})

    const fpsTimer = setInterval(() => {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
    }, 1000)

    return () => {
      controller.abort()
      clearInterval(fpsTimer)
      setActive(false)
    }
  }, [url, canvasRef])

  return { fps, active }
}

/**
 * Render one RGBA frame to a canvas element. Uses VideoFrame when available
 * for GPU-backed display, otherwise falls back to ImageData/putImageData.
 */
function renderFrame(
  canvas: HTMLCanvasElement | null,
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Size canvas to match CSS layout at device pixel ratio for crisp rendering
  const dpr = globalThis.devicePixelRatio || 1
  const cssW = canvas.clientWidth || width
  const cssH = canvas.clientHeight || height
  const physW = Math.round(cssW * dpr)
  const physH = Math.round(cssH * dpr)

  if (canvas.width !== physW || canvas.height !== physH) {
    canvas.width = physW
    canvas.height = physH
  }

  // Letterbox: preserve aspect ratio
  const scale = Math.min(physW / width, physH / height)
  const drawW = width * scale
  const drawH = height * scale
  const offsetX = (physW - drawW) / 2
  const offsetY = (physH - drawH) / 2

  ctx.clearRect(0, 0, physW, physH)

  if (HAS_VIDEO_FRAME) {
    // Copy the data so the VideoFrame owns it (buf may be reused)
    const owned = new Uint8ClampedArray(rgbaData.length)
    owned.set(rgbaData)

    let frame: VideoFrame | null = null
    try {
      frame = new VideoFrame(owned, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: performance.now() * 1000,
      })
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(frame, offsetX, offsetY, drawW, drawH)
    } catch {
      // VideoFrame construction can fail on some browsers; fall through to putImageData
      putImageDataFallback(ctx, rgbaData, width, height, physW, physH)
    } finally {
      frame?.close()
    }
  } else {
    putImageDataFallback(ctx, rgbaData, width, height, physW, physH)
  }
}

/** CPU fallback: draw via ImageData + putImageData, scaled to fit the canvas. */
function putImageDataFallback(
  ctx: CanvasRenderingContext2D,
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  physW: number,
  physH: number,
): void {
  // Copy data so we don't alias the stream buffer
  const owned = new Uint8ClampedArray(rgbaData.length)
  owned.set(rgbaData)

  const imageData = new ImageData(owned, width, height)

  // putImageData does not scale, so use an offscreen canvas to letterbox
  const offscreen = new OffscreenCanvas(width, height)
  const offCtx = offscreen.getContext('2d')
  if (!offCtx) return

  offCtx.putImageData(imageData, 0, 0)

  const scale = Math.min(physW / width, physH / height)
  const drawW = width * scale
  const drawH = height * scale
  const offsetX = (physW - drawW) / 2
  const offsetY = (physH - drawH) / 2

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(offscreen, offsetX, offsetY, drawW, drawH)
}
