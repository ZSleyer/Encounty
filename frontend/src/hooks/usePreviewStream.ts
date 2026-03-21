/**
 * usePreviewStream.ts — MJPEG preview stream via WebSocket binary frames.
 *
 * The Go backend forwards JPEG frames from the Rust sidecar as binary
 * WebSocket messages. Each message is prefixed with a 36-byte ASCII
 * session ID (the pokemon UUID) followed by raw JPEG data. This module
 * provides a dispatcher that routes frames to per-pokemon handlers, and
 * a hook that renders incoming frames to a canvas element.
 */
import { useRef, useEffect } from 'react'

const SESSION_ID_LEN = 36

// Module-level registry of preview frame handlers keyed by pokemon ID.
const previewHandlers = new Map<string, (jpeg: Uint8Array) => void>()

/** Route a binary WebSocket message to the correct preview handler. */
export function dispatchPreviewFrame(data: ArrayBuffer): void {
  if (data.byteLength <= SESSION_ID_LEN) return
  const view = new Uint8Array(data)
  const sessionId = new TextDecoder().decode(view.slice(0, SESSION_ID_LEN))
  const handler = previewHandlers.get(sessionId)
  if (handler) {
    handler(view.slice(SESSION_ID_LEN))
  }
}

/**
 * Hook that renders incoming JPEG preview frames to a canvas element.
 *
 * Registers a handler for the given pokemonId so that binary frames
 * arriving over the shared WebSocket are decoded and drawn to the
 * referenced canvas. Automatically cleans up on unmount or when the
 * pokemonId changes.
 */
export function usePreviewStream(
  pokemonId: string | null,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): { fps: React.RefObject<number> } {
  const fpsRef = useRef(0)
  const frameCount = useRef(0)
  const lastFpsTime = useRef(performance.now())

  useEffect(() => {
    if (!pokemonId) return

    const handler = (jpeg: Uint8Array) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const jpegBuffer = new ArrayBuffer(jpeg.byteLength)
      new Uint8Array(jpegBuffer).set(jpeg)
      const blob = new Blob([jpegBuffer], { type: 'image/jpeg' })
      createImageBitmap(blob).then(bitmap => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width
          canvas.height = bitmap.height
        }
        ctx.drawImage(bitmap, 0, 0)
        bitmap.close()

        // FPS tracking
        frameCount.current++
        const now = performance.now()
        if (now - lastFpsTime.current >= 1000) {
          fpsRef.current = frameCount.current
          frameCount.current = 0
          lastFpsTime.current = now
        }
      }).catch(() => {
        // Silently ignore decode failures for corrupted frames
      })
    }

    previewHandlers.set(pokemonId, handler)
    return () => { previewHandlers.delete(pokemonId) }
  }, [pokemonId, canvasRef])

  return { fps: fpsRef }
}
