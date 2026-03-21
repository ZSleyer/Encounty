/**
 * useWebSocket.ts — WebSocket client hook with automatic reconnection.
 *
 * Connects to the Go backend's /ws endpoint and delivers incoming messages
 * to the caller via onMessage. When the connection closes for any reason the
 * hook waits RECONNECT_DELAY ms and attempts to reconnect, ensuring the UI
 * always recovers without a page reload.
 */
import { useEffect, useRef, useCallback } from 'react'
import { WSMessage } from '../types'
import { wsUrl } from '../utils/api'

const WS_URL = wsUrl()
const RECONNECT_DELAY = 2000

/**
 * useWebSocket connects to the backend WebSocket and keeps the connection
 * alive. Callbacks are stored in refs so callers never need to memoize them.
 *
 * @param onMessage - Called for every JSON message received from the server.
 * @param onConnect - Called when the connection is successfully established.
 * @param onDisconnect - Called when the connection closes.
 * @param onBinaryMessage - Called for every binary message (e.g. MJPEG preview frames).
 * @returns An object with a `send(type, payload)` function for outbound messages.
 */
export function useWebSocket(
  onMessage: (msg: WSMessage) => void,
  onConnect?: () => void,
  onDisconnect?: () => void,
  onBinaryMessage?: (data: ArrayBuffer) => void,
) {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  const onBinaryMessageRef = useRef(onBinaryMessage)
  onMessageRef.current = onMessage
  onConnectRef.current = onConnect
  onDisconnectRef.current = onDisconnect
  onBinaryMessageRef.current = onBinaryMessage

  const connect = useCallback(() => {
    const state = ws.current?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return

    const socket = new WebSocket(WS_URL)
    socket.binaryType = 'arraybuffer'
    ws.current = socket

    socket.onopen = () => {
      console.log('[WS] Connected')
      onConnectRef.current?.()
    }

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as WSMessage
          onMessageRef.current(msg)
        } catch {
          console.warn('[WS] Failed to parse message:', event.data)
        }
      } else if (event.data instanceof ArrayBuffer) {
        onBinaryMessageRef.current?.(event.data)
      }
    }

    socket.onclose = () => {
      console.log('[WS] Disconnected, reconnecting...')
      onDisconnectRef.current?.()
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
    }

    socket.onerror = () => {
      socket.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [connect])

  const send = useCallback((type: string, payload: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  return { send }
}
