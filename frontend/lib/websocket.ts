import { useEffect, useRef, useCallback, useState } from 'react'

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let listeners: Set<(data: any) => void> = new Set()
let pollTimer: NodeJS.Timeout | null = null
let pendingUrl: string | null = null

export function useWebSocket(url: string, onMessage: (data: any) => void, enabled = true) {
  const [connected, setConnected] = useState(false)
  const cbRef = useRef(onMessage)
  cbRef.current = onMessage

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    pendingUrl = url

    function connect() {
      try {
        ws = new WebSocket(url)
        ws.binaryType = 'arraybuffer'
        ws.onopen = () => {
          setConnected(true)
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
        }
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            cbRef.current(data)
          } catch {
            cbRef.current({ raw: event.data })
          }
        }
        ws.onclose = () => {
          setConnected(false)
          ws = null
          if (!pendingUrl) return
          reconnectTimer = setTimeout(connect, 3000)
        }
        ws.onerror = () => {
          ws?.close()
        }
      } catch {
        setConnected(false)
        startLongPoll()
      }
    }

    function startLongPoll() {
      if (pollTimer) return
      pollTimer = setInterval(async () => {
        if (!pendingUrl) return
        try {
          const res = await fetch(pendingUrl.replace(/ws(s?):\/\//, 'http$1://') + '/poll')
          const data = await res.json().catch(() => ({}))
          if (data.items) data.items.forEach(cbRef.current)
          else cbRef.current(data)
        } catch {
          /* silent */
        }
      }, 3000)
    }

    connect()

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pollTimer) clearInterval(pollTimer)
      ws?.close()
      ws = null
      setConnected(false)
    }
  }, [url, enabled])

  const send = useCallback((data: any) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }, [])

  return { connected, send }
}
