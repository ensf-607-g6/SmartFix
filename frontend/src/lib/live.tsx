import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { socketUrl } from '../api/client'
import { useAuth } from '../auth/AuthContext'

interface LiveEvent {
  type: 'event'
  event_name: string
  issue_id: string | null
  report_id: string | null
  occurred_at: string
}

interface LiveValue {
  connected: boolean
  lastEvent: LiveEvent | null
}

const LiveContext = createContext<LiveValue>({
  connected: false,
  lastEvent: null,
})

const REFRESH_KEYS = [
  'map',
  'issue',
  'my-reports',
  'report',
  'work-orders',
  'review',
  'summary',
  'notifications',
]

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)

  useEffect(() => {
    if (!user) return
    let socket: WebSocket | null = null
    let closed = false
    let retry = 0
    let ping: ReturnType<typeof setInterval> | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      socket = new WebSocket(socketUrl())
      socket.onopen = () => {
        retry = 0
        setConnected(true)
        ping = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send('ping')
        }, 25000)
      }
      socket.onmessage = (message) => {
        let data: unknown
        try {
          data = JSON.parse(String(message.data))
        } catch {
          return
        }
        if (!data || typeof data !== 'object' || !('type' in data)) return
        if (data.type === 'event') {
          const event = data as LiveEvent
          setLastEvent(event)
          for (const key of REFRESH_KEYS) {
            void queryClient.invalidateQueries({ queryKey: [key] })
          }
        } else if (data.type === 'notification') {
          void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        }
      }
      socket.onclose = () => {
        setConnected(false)
        clearInterval(ping)
        if (!closed) {
          reconnect = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000))
        }
      }
    }

    connect()
    return () => {
      closed = true
      clearInterval(ping)
      clearTimeout(reconnect)
      socket?.close()
    }
  }, [queryClient, user])

  return (
    <LiveContext.Provider value={{ connected, lastEvent }}>
      {children}
    </LiveContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLive() {
  return useContext(LiveContext)
}
