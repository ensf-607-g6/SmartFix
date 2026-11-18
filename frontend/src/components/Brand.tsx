export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${dark ? 'bg-white/10' : 'bg-ink-900'}`}>
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
          <path
            d="M9 21l6-6m0 0l2-5 5-2-2 5-5 2m0 0l6 6"
            stroke="#F5A524"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </span>
      <div className="leading-tight">
        <p className={`text-lg font-bold tracking-tight ${dark ? 'text-white' : 'text-ink-900'}`}>SmartFix</p>
        <p className={`text-[11px] font-medium ${dark ? 'text-ink-300' : 'text-ink-500'}`}>Public infrastructure</p>
      </div>
    </div>
  )
}
