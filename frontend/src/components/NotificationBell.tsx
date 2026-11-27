import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellRing, CheckCheck } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { Notification } from '../api/types'
import { eventLabel, timeAgo } from '../lib/format'

export function NotificationBell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'))
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  })
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = data?.unread ?? 0
  return (
    <div className="relative" ref={box}>
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-ink-100 bg-white text-ink-700 transition hover:border-ink-200 hover:text-ink-900"
        aria-label={t('notifications.bellLabel', { count: unread })}
      >
        <Bell aria-hidden className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-ink-950 ring-2 ring-paper">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('a11y.notifications')}
          className="card absolute right-0 top-12 z-[1200] w-[400px] overflow-hidden shadow-lift"
        >
          <div className="flex items-center justify-between border-b border-paper-200 px-4 py-3">
            <h3 className="text-sm font-semibold">{t('notifications.title')}</h3>
            <button
              onClick={() => readAll.mutate()}
              disabled={!unread}
              className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900 disabled:opacity-40"
            >
              <CheckCheck aria-hidden className="h-3.5 w-3.5" /> {t('notifications.markAllRead')}
            </button>
          </div>
          {permission === 'default' && (
            <button
              onClick={() => Notification.requestPermission().then(setPermission)}
              className="flex w-full items-center gap-2 border-b border-paper-200 bg-ink-50 px-4 py-2.5 text-left text-xs font-medium text-ink-700 hover:bg-ink-100"
            >
              <BellRing aria-hidden className="h-4 w-4" /> {t('notifications.enableDesktopAlerts')}
            </button>
          )}
          <ul className="max-h-[420px] divide-y divide-paper-200 overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-10 text-center text-sm text-ink-500">{t('notifications.empty')}</li>}
            {data?.items.map((n) => (
              <li key={n.notification_id} className={`flex gap-3 px-4 py-3 ${n.read_at ? '' : 'bg-accent-50/50'}`}>
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-accent-500'}`} />
                <div className="min-w-0">
                  <p className="text-sm leading-snug text-ink-800">
                    {!n.read_at && <span className="sr-only">{t('a11y.unread')} </span>}
                    {n.message}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-500">
                    {n.event_name && `${eventLabel(n.event_name)} · `}
                    {timeAgo(n.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
