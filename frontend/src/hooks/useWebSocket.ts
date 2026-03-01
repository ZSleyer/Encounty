import { useEffect, useRef, useCallback } from 'react'
import { WSMessage } from '../types'

const WS_URL = `ws://${globalThis.location.host}/ws`
const RECONNECT_DELAY = 2000

export function useWebSocket(
  onMessage: (msg: WSMessage) => void,
  onConnect?: () => void,
  onDisconnect?: () => void,
) {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  onMessageRef.current = onMessage
  onConnectRef.current = onConnect
  onDisconnectRef.current = onDisconnect

  const connect = useCallback(() => {
    const state = ws.current?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      console.log('[WS] Connected')
      onConnectRef.current?.()
    }

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage
        onMessageRef.current(msg)
      } catch {
        console.warn('[WS] Failed to parse message:', event.data)
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
