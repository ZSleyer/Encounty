/**
 * useMJPEGStream.ts — MJPEG-over-HTTP stream consumer with canvas rendering.
 *
 * Fetches a multipart/x-mixed-replace MJPEG stream via the Fetch API,
 * parses individual JPEG frames from the chunked response, and renders
 * them to a canvas element using createImageBitmap (GPU-accelerated).
 */
import { useEffect, useRef, useState } from 'react'

/** Find needle in haystack starting at offset. Returns -1 if not found. */
function indexOf(haystack: Uint8Array, needle: Uint8Array, offset = 0): number {
  const len = needle.length
  const limit = haystack.length - len
  outer: for (let i = offset; i <= limit; i++) {
    for (let j = 0; j < len; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

const HEADER_END = new TextEncoder().encode('\r\n\r\n')

/** Read an MJPEG multipart stream and call onFrame for each JPEG payload. */
async function consumeMJPEGStream(
  url: string,
  signal: AbortSignal,
  onFrame: (jpeg: Uint8Array) => void,
): Promise<void> {
  const resp = await fetch(url, { signal })
  if (!resp.body) return

  const reader = resp.body.getReader()
  let buf = new Uint8Array(0)

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    // Append chunk to buffer
    const next = new Uint8Array(buf.length + value.length)
    next.set(buf)
    next.set(value, buf.length)
    buf = next

    // Extract complete frames
    for (;;) {
      const hdrEnd = indexOf(buf, HEADER_END)
      if (hdrEnd === -1) break

      const headerText = new TextDecoder().decode(buf.subarray(0, hdrEnd))
      const clMatch = headerText.match(/Content-Length:\s*(\d+)/i)
      if (!clMatch) {
        buf = buf.subarray(hdrEnd + HEADER_END.length)
        continue
      }

      const contentLength = parseInt(clMatch[1], 10)
      const payloadStart = hdrEnd + HEADER_END.length
      const payloadEnd = payloadStart + contentLength

      if (buf.length < payloadEnd) break

      onFrame(buf.slice(payloadStart, payloadEnd))

      const frameEnd = Math.min(payloadEnd + 2, buf.length)
      buf = buf.subarray(frameEnd)
    }
  }
}

/**
 * Hook that consumes an MJPEG-over-HTTP stream and renders frames to a
 * canvas element using createImageBitmap for GPU-accelerated decoding.
 * Only the latest frame is rendered; intermediate frames are skipped if
 * the decode pipeline is still busy.
 */
export function useMJPEGStream(
  url: string | null,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): { fps: number } {
  const [fps, setFps] = useState(0)
  const frameCountRef = useRef(0)

  useEffect(() => {
    if (!url) return

    const controller = new AbortController()
    let pending: Uint8Array | null = null
    let decoding = false

    const renderPending = () => {
      const jpeg = pending
      if (!jpeg) return
      pending = null
      decoding = true

      createImageBitmap(new Blob([jpeg.buffer as ArrayBuffer], { type: 'image/jpeg' })).then(bitmap => {
        const canvas = canvasRef.current
        if (!canvas) { bitmap.close(); return }

        const ctx = canvas.getContext('2d')
        if (!ctx) { bitmap.close(); return }

        // Size canvas to match CSS layout at device pixel ratio for crisp rendering
        const dpr = globalThis.devicePixelRatio || 1
        const cssW = canvas.clientWidth || bitmap.width
        const cssH = canvas.clientHeight || bitmap.height
        const physW = Math.round(cssW * dpr)
        const physH = Math.round(cssH * dpr)

        if (canvas.width !== physW || canvas.height !== physH) {
          canvas.width = physW
          canvas.height = physH
        }

        // Letterbox: preserve aspect ratio
        const scale = Math.min(physW / bitmap.width, physH / bitmap.height)
        const drawW = bitmap.width * scale
        const drawH = bitmap.height * scale
        const offsetX = (physW - drawW) / 2
        const offsetY = (physH - drawH) / 2

        ctx.clearRect(0, 0, physW, physH)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(bitmap, offsetX, offsetY, drawW, drawH)
        bitmap.close()

        frameCountRef.current++
      }).catch(() => {
        // Ignore decode failures for corrupted frames
      }).finally(() => {
        decoding = false
        if (pending) renderPending()
      })
    }

    const onFrame = (jpeg: Uint8Array) => {
      pending = jpeg
      if (!decoding) renderPending()
    }

    consumeMJPEGStream(url, controller.signal, onFrame).catch(() => {})

    const fpsTimer = setInterval(() => {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
    }, 1000)

    return () => {
      controller.abort()
      clearInterval(fpsTimer)
    }
  }, [url, canvasRef])

  return { fps }
}
