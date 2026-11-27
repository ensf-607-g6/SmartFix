import { Bell, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ToastItem {
  id: number
  message: string
  tone: 'info' | 'error' | 'success'
}

interface ToastValue {
  show: (message: string, tone?: ToastItem['tone']) => void
}

const ToastContext = createContext<ToastValue>({ show: () => undefined })

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t: translate } = useTranslation()
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (message: string, tone: ToastItem['tone'] = 'info') => {
      const id = Date.now() + Math.random()
      setItems((all) => [...all.slice(-3), { id, message, tone }])
      setTimeout(() => dismiss(id), 6000)
    },
    [dismiss],
  )
  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[2000] flex w-96 flex-col gap-3" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lift ${
              t.tone === 'error' ? 'border-danger-600/30 bg-danger-50 text-danger-700' : 'border-ink-800 bg-ink-900 text-white'
            }`}
          >
            <Bell aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${t.tone === 'error' ? '' : 'text-accent-400'}`} />
            <p className="flex-1 text-sm leading-relaxed">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100" aria-label={translate('common.dismiss')}>
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
