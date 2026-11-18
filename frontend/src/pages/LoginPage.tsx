import { ArrowRight, HardHat, Home, Map, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'
import { ErrorNote, Field } from '../components/ui'

const DEMO = [
  { email: 'resident@smartfix.dev', label: 'Resident', icon: Home },
  { email: 'operator@smartfix.dev', label: 'City operator', icon: Map },
  {
    email: 'crew.north@smartfix.dev',
    label: 'Crew (Roads North)',
    icon: HardHat,
  },
  { email: 'supervisor@smartfix.dev', label: 'Supervisor', icon: ShieldCheck },
]

export function LoginPage() {
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={homeFor(user.role)} replace />

  const submit = async (
    e: FormEvent,
    override?: { email: string; password: string },
  ) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u =
        mode === 'register' && !override
          ? await register(fullName, email, password)
          : await login(
              override?.email ?? email,
              override?.password ?? password,
            )
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
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.07]"
          aria-hidden
        >
          <defs>
            <pattern
              id="grid"
              width="48"
              height="48"
              patternUnits="userSpaceOnUse"
            >
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
            Spot it. Snap it.{' '}
            <span className="text-accent-400">We fix it.</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-ink-200">
            Report potholes, broken streetlights, leaks and cracked sidewalks in
            seconds. SmartFix checks every photo, puts the most dangerous
            problems first, and keeps you updated until the repair is done.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
            {[
              ['< 15 s', 'to classify a photo'],
              ['50 m', 'duplicate matching'],
              ['7 days', 'to confirm a repair'],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="text-2xl font-bold text-white">{v}</dt>
                <dd className="mt-1 text-xs text-ink-300">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="relative text-xs text-ink-400">
          ENSF 607 · Group 6 · Supporting UN SDG 9.1
        </p>
      </section>

      <section className="flex flex-1 items-center justify-center p-12">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold tracking-tight">
            {mode === 'login' ? 'Sign in' : 'Create a resident account'}
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {mode === 'login'
              ? 'Welcome back. Use your SmartFix account.'
              : 'Residents can sign up to report problems.'}
          </p>

          <form
            onSubmit={(event) => void submit(event)}
            className="mt-8 space-y-4"
          >
            {mode === 'register' && (
              <Field label="Full name">
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </Field>
            )}
            <Field label="Email">
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Password">
              <input
                className="input"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <button className="btn-primary w-full py-2.5" disabled={busy}>
              {mode === 'login' ? 'Sign in' : 'Create account'}{' '}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-ink-500">
            {mode === 'login' ? 'New resident?' : 'Already have an account?'}{' '}
            <button
              className="font-semibold text-ink-900 underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>

          {mode === 'login' && (
            <div className="mt-10 border-t border-paper-300 pt-6">
              <p className="label">Demo accounts · password smartfix123</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {DEMO.map((d) => (
                  <button
                    type="button"
                    key={d.email}
                    disabled={busy}
                    onClick={(event) =>
                      void submit(event, {
                        email: d.email,
                        password: 'smartfix123',
                      })
                    }
                    className="flex items-center gap-2.5 rounded-lg border border-ink-100 bg-white px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:shadow-card"
                  >
                    <d.icon className="h-4 w-4 text-ink-500" />
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
