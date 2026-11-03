import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-sand px-6">
      <div className="max-w-lg text-center">
        <div className="flex justify-center">
          <Brand />
        </div>
        <p className="mt-12 text-sm font-bold uppercase tracking-[0.18em] text-forest-600">
          404
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
          This route needs repair.
        </h1>
        <p className="mt-4 leading-7 text-slate-600">
          The page you requested is not part of the current SmartFix workspace.
        </p>
        <Link
          to="/login"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-forest-900 px-5 py-3 text-sm font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to SmartFix
        </Link>
      </div>
    </main>
  )
}
