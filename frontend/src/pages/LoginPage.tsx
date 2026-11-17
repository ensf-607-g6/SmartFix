import {
  ArrowRight,
  Building2,
  HardHat,
  MapPin,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { roles, type UserRole } from '../auth/types'
import { useAuth } from '../auth/useAuth'
import { Brand } from '../components/Brand'

const roleDetails: Record<
  UserRole,
  { label: string; description: string; icon: typeof UserRound }
> = {
  resident: {
    label: 'Resident',
    description: 'Report damage and follow repairs.',
    icon: UserRound,
  },
  crew: {
    label: 'Repair crew',
    description: 'Manage assigned work orders.',
    icon: HardHat,
  },
  operator: {
    label: 'City operator',
    description: 'Monitor, review, and coordinate.',
    icon: Building2,
  },
}

export function LoginPage() {
  const { isReady, user, signInAs } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isReady && user) navigate(`/${user.role}`, { replace: true })
  }, [isReady, navigate, user])

  const chooseRole = (role: UserRole) => {
    signInAs(role)
    navigate(`/${role}`, { replace: true })
  }

  return (
    <main className="min-h-screen bg-sand px-5 py-6 sm:px-8 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:gap-8 lg:p-8">
      <section className="relative hidden overflow-hidden rounded-[2rem] bg-forest-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-forest-500/20 blur-3xl" />
        <div className="absolute -bottom-24 left-12 h-72 w-72 rounded-full bg-amber/20 blur-3xl" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-forest-100">
            <MapPin className="h-4 w-4" />
            Calgary infrastructure, connected
          </div>
          <h1 className="mt-8 max-w-2xl text-6xl font-semibold leading-[1.03] tracking-[-0.04em]">
            Report it. Track it. See it fixed.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-forest-100/80">
            SmartFix gives residents, repair crews, and city operators one clear
            view of every public-infrastructure repair.
          </p>
        </div>
        <div className="relative z-10 mt-auto grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-5">
            <ShieldCheck className="h-6 w-6 text-amber" />
            <p className="mt-4 text-sm font-semibold">Role-aware access</p>
            <p className="mt-1 text-sm text-forest-100/65">
              The right tools for every user.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-5">
            <MapPin className="h-6 w-6 text-amber" />
            <p className="mt-4 text-sm font-semibold">
              Location-first reporting
            </p>
            <p className="mt-1 text-sm text-forest-100/65">
              From first report to final repair.
            </p>
          </div>
        </div>
      </section>

      <section className="flex min-h-[calc(100vh-3rem)] items-center justify-center lg:min-h-0">
        <div className="w-full max-w-xl">
          <Brand />
          <div className="mt-12">
            <p className="text-sm font-semibold text-forest-700">
              Welcome, Sodeeq
            </p>
            <h2 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
              Choose a workspace
            </h2>
            <p className="mt-3 text-slate-600">
              Temporary role selection while the authentication API is being
              completed.
            </p>
          </div>

          <div className="mt-8 space-y-3">
            {roles.map((role) => {
              const { label, description, icon: Icon } = roleDetails[role]
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => chooseRole(role)}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-forest-300"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest-800 group-hover:bg-forest-900 group-hover:text-white">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-950">
                      {label}
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-500">
                      {description}
                    </span>
                  </span>
                  <ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-forest-700" />
                </button>
              )
            })}
          </div>

          <p className="mt-8 text-center text-xs leading-5 text-slate-500">
            Demo access only. Real credentials and permissions will be supplied
            by the authentication service.
          </p>
        </div>
      </section>
    </main>
  )
}
