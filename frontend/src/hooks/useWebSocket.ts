/**
 * useWebSocket.ts — Single shared WebSocket client with automatic reconnection.
 *
 * WebSocketProvider opens exactly one connection to the Go backend's /ws
 * endpoint for the whole app. Consumers register message/lifecycle handlers via
 * the useWebSocket hook, which subscribes to the shared connection instead of
 * opening its own socket. This means every backend broadcast is parsed once and
 * fanned out to all subscribers, and there is a single reconnect loop.
 *
 * Reconnection uses exponential backoff with jitter and a cap so a dead backend
 * is retried with increasing delays instead of being hammered every 2 seconds.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { WSMessage } from '../types'
import { wsUrl } from '../utils/api'

const WS_URL = wsUrl()

// Reconnect backoff: base doubles each attempt up to a cap, plus random jitter
// so many clients recovering at once do not reconnect in lockstep.
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000
const RECONNECT_JITTER_MS = 1000

/**
 * nextReconnectDelay returns the backoff delay for the given zero-based retry
 * attempt: min(cap, base * 2^attempt) plus up to RECONNECT_JITTER_MS of jitter.
 */
function nextReconnectDelay(attempt: number): number {
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
  return exponential + Math.random() * RECONNECT_JITTER_MS
}

/** Handlers a consumer registers on the shared connection. */
interface Subscriber {
  onMessage: (msg: WSMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

/** Public surface exposed to consumers of the shared WebSocket. */
interface WebSocketContextValue {
  /** Send a typed message to the backend if the socket is currently open. */
  send: (type: string, payload: unknown) => void
  /** Register handlers on the shared connection; returns an unsubscribe. */
  subscribe: (subscriber: Subscriber) => () => void
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

/**
 * WebSocketProvider owns the single application WebSocket. It parses each
 * incoming message once, fans it out to every subscriber, and manages the
 * reconnect loop with exponential backoff. Wrap the part of the tree that needs
 * the shared connection in this provider.
 *
 * @param props.children - The subtree that may consume useWebSocket.
 */
export function WebSocketProvider({ children }: Readonly<{ children: ReactNode }>) {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)
  const unmounted = useRef(false)
  const subscribers = useRef<Set<Subscriber>>(new Set())

  const connect = useCallback(() => {
    if (unmounted.current) return
    const state = ws.current?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return

    const socket = new WebSocket(WS_URL)
    socket.binaryType = 'arraybuffer'
    ws.current = socket

    socket.onopen = () => {
      console.log('[WS] Connected')
      // Successful open resets the backoff so the next drop retries quickly.
      attempts.current = 0
      subscribers.current.forEach((s) => s.onConnect?.())
    }

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let msg: WSMessage
      try {
        msg = JSON.parse(event.data) as WSMessage
      } catch {
        console.warn('[WS] Failed to parse message:', event.data)
        return
      }
      subscribers.current.forEach((s) => s.onMessage(msg))
    }

    socket.onclose = () => {
      subscribers.current.forEach((s) => s.onDisconnect?.())
      if (unmounted.current) return
      console.log('[WS] Disconnected, reconnecting...')
      const delay = nextReconnectDelay(attempts.current)
      attempts.current += 1
      reconnectTimer.current = setTimeout(connect, delay)
    }

    socket.onerror = () => {
      socket.close()
    }
  }, [])

  useEffect(() => {
    unmounted.current = false
    connect()
    return () => {
      unmounted.current = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [connect])

  const send = useCallback((type: string, payload: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  const subscribe = useCallback((subscriber: Subscriber) => {
    subscribers.current.add(subscriber)
    return () => {
      subscribers.current.delete(subscriber)
    }
  }, [])

  const value = useMemo<WebSocketContextValue>(() => ({ send, subscribe }), [send, subscribe])

  return createElement(WebSocketContext.Provider, { value }, children)
}

/**
 * useWebSocket subscribes to the shared WebSocket connection. Callbacks are
 * stored in refs so callers never need to memoize them, and the subscription is
 * removed on unmount so listeners never accumulate across reconnects.
 *
 * @param onMessage - Called for every JSON message received from the server.
 * @param onConnect - Called when the shared connection is established.
 * @param onDisconnect - Called when the shared connection closes.
 * @returns An object with a `send(type, payload)` function for outbound messages.
 */
export function useWebSocket(
  onMessage: (msg: WSMessage) => void,
  onConnect?: () => void,
  onDisconnect?: () => void,
) {
  const ctx = useContext(WebSocketContext)
  if (!ctx) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }

  const onMessageRef = useRef(onMessage)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  onMessageRef.current = onMessage
  onConnectRef.current = onConnect
  onDisconnectRef.current = onDisconnect

  const { subscribe, send } = ctx
  useEffect(() => {
    return subscribe({
      onMessage: (msg) => onMessageRef.current(msg),
      onConnect: () => onConnectRef.current?.(),
      onDisconnect: () => onDisconnectRef.current?.(),
    })
  }, [subscribe])

  return { send }
}
