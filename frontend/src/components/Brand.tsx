import { Wrench } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-forest-900 text-white shadow-lg shadow-forest-950/15">
        <Wrench className="h-5 w-5" aria-hidden="true" />
      </span>
      {!compact && (
        <span>
          <strong className="block text-lg leading-5 tracking-tight text-forest-950">
            SmartFix
          </strong>
          <span className="text-xs font-medium text-forest-700">
            Infrastructure, connected
          </span>
        </span>
      )}
    </div>
  )
}
