import { ArrowRight, HardHat, Home, Map, ShieldCheck } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'
import { ErrorNote, Field } from '../components/ui'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const DEMO_PASSWORD = 'smartfix123'

const DEMO = [
  { email: 'resident@smartfix.dev', label: 'login.demoResident', icon: Home },
  { email: 'operator@smartfix.dev', label: 'login.demoOperator', icon: Map },
  { email: 'crew.north@smartfix.dev', label: 'login.demoCrewNorth', icon: HardHat },
  { email: 'supervisor@smartfix.dev', label: 'login.demoSupervisor', icon: ShieldCheck },
] as const

export function LoginPage() {
  const { t } = useTranslation()
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const headingId = useId()
  const demoId = useId()
  useDocumentTitle(mode === 'login' ? t('login.signInTitle') : t('login.registerTitle'))

  if (user) return <Navigate to={homeFor(user.role)} replace />

  const submit = async (e: FormEvent, override?: { email: string; password: string }) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u =
        mode === 'register' && !override
          ? await register(fullName, email, password)
          : await login(override?.email ?? email, override?.password ?? password)
      navigate(homeFor(u.role), { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full">
      <section className="relative flex w-[46%] flex-col justify-between overflow-hidden bg-ink-900 p-14 text-white">
        <svg className="absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden>
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="relative">
          <Brand dark />
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            {t('login.heroTitle')} <span className="text-accent-400">{t('login.heroAccent')}</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-ink-200">
            {t('login.heroBody')}
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
            {[
              [t('login.statClassifyValue'), t('login.statClassifyLabel')],
              [t('login.statDuplicateValue'), t('login.statDuplicateLabel')],
              [t('login.statConfirmValue'), t('login.statConfirmLabel')],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="text-2xl font-bold text-white">{v}</dt>
                <dd className="mt-1 text-xs text-ink-300">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="relative text-xs text-ink-400">{t('login.footer')}</p>
      </section>

      <main className="flex flex-1 items-center justify-center p-12">
        <div className="w-full max-w-md">
          <h2 id={headingId} className="text-2xl font-bold tracking-tight">{mode === 'login' ? t('login.signInTitle') : t('login.registerTitle')}</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {mode === 'login' ? t('login.signInSubtitle') : t('login.registerSubtitle')}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4" aria-labelledby={headingId}>
            {mode === 'register' && (
              <Field label={t('login.fullName')}>
                <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </Field>
            )}
            <Field label={t('login.email')}>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label={t('login.password')}>
              <input
                className="input"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <button className="btn-primary w-full py-2.5" disabled={busy}>
              {mode === 'login' ? t('login.signInButton') : t('login.createAccountButton')} <ArrowRight aria-hidden className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-ink-500">
            {mode === 'login' ? t('login.newResident') : t('login.haveAccount')}{' '}
            <button
              className="font-semibold text-ink-900 underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {mode === 'login' ? t('login.switchToRegister') : t('login.switchToSignIn')}
            </button>
          </p>

          {mode === 'login' && (
            <div className="mt-10 border-t border-paper-300 pt-6">
              <p id={demoId} className="label">{t('login.demoAccounts', { password: DEMO_PASSWORD })}</p>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-labelledby={demoId}>
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    disabled={busy}
                    onClick={(e) => submit(e, { email: d.email, password: DEMO_PASSWORD })}
                    className="flex items-center gap-2.5 rounded-lg border border-ink-100 bg-white px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:shadow-card"
                  >
                    <d.icon aria-hidden className="h-4 w-4 text-ink-500" />
                    {t(d.label)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
