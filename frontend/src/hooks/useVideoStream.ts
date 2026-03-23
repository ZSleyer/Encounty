/**
 * useVideoStream.ts — MSE-based H.264 fMP4 stream consumer.
 *
 * Fetches a continuous fMP4 byte stream from the backend via the Fetch API,
 * pumps chunks into a MediaSource SourceBuffer, and lets the browser's
 * native hardware-accelerated H.264 decoder handle playback in a `<video>`.
 *
 * The codec string is dynamically extracted from the init segment (ftyp+moov)
 * so it exactly matches what the encoder actually produces, regardless of
 * profile/level negotiation.
 *
 * Exposes `active` rather than a static `supported` flag: `active` becomes
 * true only once the first video chunk has been successfully appended,
 * so the caller can fall back to MJPEG when the backend sends JPEG-only.
 */
import { useEffect, useRef, useState } from 'react'

/** Fallback codec used when the init segment cannot be parsed. */
const FALLBACK_CODEC = 'video/mp4; codecs="avc1.42E01E"'

/** Whether the browser supports MSE at all (basic H.264 check). */
function isMSESupported(): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported(FALLBACK_CODEC)
  )
}

/** Extract avc1 codec string from fMP4 init segment by finding the avcC box. */
function extractCodecFromInit(data: Uint8Array): string | null {
  // Search for 'avcC' box marker
  const needle = [0x61, 0x76, 0x63, 0x43] // 'avcC'
  for (let i = 0; i < data.length - 7; i++) {
    if (
      data[i] === needle[0] &&
      data[i + 1] === needle[1] &&
      data[i + 2] === needle[2] &&
      data[i + 3] === needle[3]
    ) {
      // avcC body starts right after the 4-byte tag
      const bodyStart = i + 4
      if (bodyStart + 4 > data.length) return null
      const profileIdc = data[bodyStart + 1]
      const compatFlags = data[bodyStart + 2]
      const levelIdc = data[bodyStart + 3]
      const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
      return `avc1.${hex(profileIdc)}${hex(compatFlags)}${hex(levelIdc)}`
    }
  }
  return null
}

/**
 * Check whether a chunk is an fMP4 init segment by looking for the 'ftyp'
 * box signature at bytes 4-7.
 */
function isInitSegment(data: Uint8Array): boolean {
  if (data.length < 8) return false
  // 'ftyp' = 0x66 0x74 0x79 0x70
  return (
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  )
}

/**
 * Hook that consumes an fMP4-over-HTTP stream and plays it in a `<video>`
 * element via Media Source Extensions for hardware-accelerated H.264 decoding.
 *
 * Returns `fps` (approximate fragments/sec) and `active` (true once video
 * data is actually flowing). When `active` is false the caller should keep
 * the MJPEG canvas path visible as a fallback.
 */
export function useVideoStream(
  url: string | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): { fps: number; active: boolean } {
  const [fps, setFps] = useState(0)
  const [active, setActive] = useState(false)
  const mseOk = useRef(isMSESupported()).current
  const frameCountRef = useRef(0)

  useEffect(() => {
    if (!url || !mseOk) return

    const controller = new AbortController()
    let mediaSource: MediaSource | null = null
    let objectUrl = ''
    let sourceBuffer: SourceBuffer | null = null
    let queue: Uint8Array[] = []
    let draining = false
    let activated = false
    // Becomes true once we have created the SourceBuffer from the init segment
    let sourceBufferReady = false

    const drain = () => {
      if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) {
        draining = false
        return
      }
      draining = true
      const chunk = queue.shift()!
      try {
        sourceBuffer.appendBuffer(chunk.buffer as ArrayBuffer)
      } catch (err) {
        draining = false
      }
    }

    /**
     * Create the SourceBuffer using the codec extracted from the init segment,
     * wire up the updateend listener, then enqueue the init data.
     */
    const createSourceBuffer = (codec: string, initData: Uint8Array) => {
      if (!mediaSource || mediaSource.readyState !== 'open') return

      const mimeCodec = `video/mp4; codecs="${codec}"`
      sourceBuffer = mediaSource.addSourceBuffer(mimeCodec)
      sourceBuffer.mode = 'sequence'

      // Track whether the last SourceBuffer operation was a remove so
      // the updateend handler can distinguish append-completions from
      // remove-completions.  Without this, remove() → updateend →
      // remove() loops indefinitely, starving the event loop.
      let pendingRemove = false

      sourceBuffer.addEventListener('updateend', () => {
        if (pendingRemove) {
          pendingRemove = false
          drain()
          return
        }

        frameCountRef.current++

        if (!activated) {
          activated = true
          setActive(true)
        }

        // Trim buffer to prevent memory growth — keep last 2 seconds
        const video = videoRef.current
        if (video && sourceBuffer && !sourceBuffer.updating) {
          const trimEnd = video.currentTime - 2
          if (
            trimEnd > 0 &&
            sourceBuffer.buffered.length > 0 &&
            sourceBuffer.buffered.start(0) < trimEnd
          ) {
            try {
              pendingRemove = true
              sourceBuffer.remove(0, trimEnd)
              return
            } catch {
              pendingRemove = false
            }
          }
        }

        drain()
      })

      // The init segment is the first thing to be appended
      queue.unshift(initData)
      sourceBufferReady = true
      drain()
    }

    const startStream = async () => {
      mediaSource = new MediaSource()
      objectUrl = URL.createObjectURL(mediaSource)

      const video = videoRef.current
      if (!video) return
      video.src = objectUrl

      await new Promise<void>((resolve) => {
        mediaSource!.addEventListener('sourceopen', () => resolve(), {
          once: true,
        })
      })

      if (controller.signal.aborted) return

      let resp: Response
      try {
        resp = await fetch(url, { signal: controller.signal })
      } catch {
        return
      }

      if (!resp.body) return
      const reader = resp.body.getReader()

      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>
        try {
          result = await reader.read()
        } catch {
          break
        }
        if (result.done) break

        const chunk = result.value

        if (isInitSegment(chunk)) {
          if (!sourceBufferReady) {
            // First init segment — create the SourceBuffer
            const codec = extractCodecFromInit(chunk)
            createSourceBuffer(codec ?? 'avc1.42E01E', chunk)
          }
          // Duplicate init segments (e.g. from stale cache) are skipped
          // once the SourceBuffer is already initialised.
        } else if (sourceBufferReady) {
          queue.push(chunk)
          if (!draining) drain()
        }
        // Non-init chunks arriving before the init segment are dropped —
        // MSE cannot decode without the init segment.
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

      if (sourceBuffer && mediaSource && mediaSource.readyState === 'open') {
        try {
          mediaSource.removeSourceBuffer(sourceBuffer)
        } catch {
          /* ignore */
        }
      }
      if (mediaSource && mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream()
        } catch {
          /* ignore */
        }
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
      const video = videoRef.current
      if (video) {
        video.src = ''
        video.load()
      }
    }
  }, [url, videoRef, mseOk])

  return { fps, active }
}
