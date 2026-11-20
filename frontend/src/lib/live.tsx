import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { socketUrl } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'

export interface LiveEvent {
  type: 'event'
  event_name: string
  issue_id: string | null
  report_id: string | null
  occurred_at: string
  payload: Record<string, unknown>
}

interface LiveValue {
  connected: boolean
  lastEvent: LiveEvent | null
}

const LiveContext = createContext<LiveValue>({ connected: false, lastEvent: null })

/** Query keys that any processed event may have changed (NFR-2: pages refresh within 2 s). */
const REFRESH_KEYS = ['map', 'issue', 'timeline', 'my-reports', 'report', 'work-orders', 'review', 'summary', 'stats']

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    if (!user) return
    let socket: WebSocket | null = null
    let retry = 0
    let closed = false
    let ping: ReturnType<typeof setInterval> | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined

    const open = () => {
      socket = new WebSocket(socketUrl())
      socket.onopen = () => {
        retry = 0
        setConnected(true)
        ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 25000)
      }
      socket.onmessage = (msg) => {
        const data = JSON.parse(msg.data)
        if (data.type === 'event') {
          setLastEvent(data)
          for (const key of REFRESH_KEYS) queryClient.invalidateQueries({ queryKey: [key] })
        } else if (data.type === 'notification') {
          queryClient.invalidateQueries({ queryKey: ['notifications'] })
          toastRef.current.show(data.message)
          if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            new Notification('SmartFix', { body: data.message, icon: '/favicon.svg' })
          }
        }
      }
      socket.onclose = () => {
        setConnected(false)
        clearInterval(ping)
        if (!closed) reconnect = setTimeout(open, Math.min(1000 * 2 ** retry++, 15000))
      }
    }
    open()
    return () => {
      closed = true
      clearInterval(ping)
      clearTimeout(reconnect)
      socket?.close()
    }
  }, [user, queryClient])

  return <LiveContext.Provider value={{ connected, lastEvent }}>{children}</LiveContext.Provider>
}

export const useLive = () => useContext(LiveContext)
