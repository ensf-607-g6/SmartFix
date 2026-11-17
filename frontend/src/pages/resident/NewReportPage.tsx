import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Crosshair, MapPin, Send } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { ProblemType } from '../../api/types'
import { PhotoDropzone } from '../../components/PhotoDropzone'
import { ProblemIcon } from '../../components/ProblemIcon'
import { BaseMap, ClickToPlace, FlyTo, PlacedPin } from '../../components/maps'
import { ErrorNote, Field, PageHeader } from '../../components/ui'

interface Accepted {
  report_id: string
  issue_id: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`,
    )
    const raw: unknown = await r.json()
    if (!raw || typeof raw !== 'object') return null
    const data = raw as Record<string, unknown>
    const addressValue = data.address
    const address =
      addressValue && typeof addressValue === 'object'
        ? (addressValue as Record<string, unknown>)
        : {}
    const street = [text(address.house_number), text(address.road)]
      .filter(Boolean)
      .join(' ')
    return (
      [street, text(address.neighbourhood) || text(address.suburb)]
        .filter(Boolean)
        .join(', ') ||
      text(data.display_name) ||
      null
    )
  } catch {
    return null
  }
}

export function NewReportPage() {
  const queryClient = useQueryClient()
  const { data: types = [], isError: typesError } = useQuery({
    queryKey: ['problem-types'],
    queryFn: () => api.get<ProblemType[]>('/problem-types'),
    staleTime: Infinity,
  })
  const [pin, setPin] = useState<[number, number] | null>(null)
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [category, setCategory] = useState<string>('')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)

  useEffect(() => {
    if (!pin) return
    let cancelled = false
    const t = setTimeout(() => {
      void reverseGeocode(pin[0], pin[1]).then((found) => {
        if (!cancelled && found) setAddress(found)
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [pin])

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('photo', photo!)
      form.append('lat', String(pin![0]))
      form.append('lng', String(pin![1]))
      form.append('problem_type', category)
      if (description.trim()) form.append('description', description.trim())
      if (address.trim()) form.append('address', address.trim())
      return api.upload<Accepted>('/reports', form)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['my-reports'] }),
  })

  const locate = () => {
    if (!navigator.geolocation)
      return setLocError('Your browser cannot share its location.')
    setLocating(true)
    setLocError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setPin(p)
        setFlyTo(p)
        setLocating(false)
      },
      () => {
        setLocError(
          'Location is blocked. Click the map to drop the pin instead.',
        )
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const missing = [
    !photo && 'a photo',
    !pin && 'a map pin',
    !category && 'a category',
  ].filter(Boolean)
  const reset = () => {
    submit.reset()
    setPhoto(null)
    setPin(null)
    setCategory('')
    setDescription('')
    setAddress('')
  }

  if (submit.isSuccess) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16">
        <div className="card p-10 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-ink-900" />
          <h1 className="mt-5 text-2xl font-bold">Report received</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
            Thanks! We are checking your photo now. You will get a notification
            as soon as it has been rated and sent to a crew. No need to wait on
            this page.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              to={`/resident/reports/${submit.data.report_id}`}
              className="btn-primary"
            >
              Track this report
            </Link>
            <button onClick={reset} className="btn-secondary">
              Report another problem
            </button>
          </div>
        </div>
      </div>
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!missing.length) submit.mutate()
  }

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <PageHeader
        title="Report a problem"
        subtitle="Takes about a minute: add a photo, drop a pin, pick a category."
      />
      <form
        onSubmit={onSubmit}
        className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]"
      >
        <div className="card relative h-[46vh] min-h-[340px] overflow-hidden sm:min-h-[440px] xl:h-[calc(100vh-13rem)] xl:min-h-[560px]">
          <BaseMap>
            <ClickToPlace onPick={(lat, lng) => setPin([lat, lng])} />
            <FlyTo position={flyTo} />
            {pin && <PlacedPin lat={pin[0]} lng={pin[1]} />}
          </BaseMap>
          <div className="pointer-events-none absolute left-4 right-4 top-4 z-[500] flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
            <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-ink-800 shadow-card">
              <MapPin className="h-4 w-4 text-ink-500" />
              {pin
                ? 'Pin placed. Click again to move it.'
                : 'Click the map where the problem is'}
            </div>
            <button
              type="button"
              onClick={locate}
              className="btn-dark pointer-events-auto shadow-card"
              disabled={locating}
            >
              <Crosshair className="h-4 w-4" />{' '}
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
          </div>
          {locError && (
            <div className="absolute bottom-4 left-4 z-[500]">
              <ErrorNote>{locError}</ErrorNote>
            </div>
          )}
        </div>

        <div className="card flex flex-col gap-6 p-6">
          <div>
            <span className="label">1 · Photo</span>
            <PhotoDropzone file={photo} onChange={setPhoto} />
          </div>

          <div>
            <span className="label">2 · What kind of problem?</span>
            {typesError && (
              <div className="mb-3">
                <ErrorNote>
                  Categories could not be loaded. Please refresh and try again.
                </ErrorNote>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {types.map((t) => {
                const on = category === t.code
                return (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => setCategory(t.code)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition ${
                      on
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-100 bg-white text-ink-700 hover:border-ink-300'
                    }`}
                  >
                    <ProblemIcon code={t.code} className="h-5 w-5" />
                    <span className="text-center leading-tight">
                      {t.display_name}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            <span className="label">3 · Details (optional)</span>
            <Field label="Location">
              <input
                className="input"
                placeholder={
                  pin
                    ? 'Looking up the address…'
                    : 'Filled in when you drop the pin'
                }
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={300}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="input min-h-[84px] resize-none"
                placeholder="e.g. Deep pothole in the right lane, cars are swerving around it"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
            </Field>
          </div>

          <div className="mt-auto space-y-3">
            {submit.isError && <ErrorNote>{submit.error.message}</ErrorNote>}
            <button
              className="btn-primary w-full py-3 text-base"
              disabled={!!missing.length || submit.isPending}
            >
              <Send className="h-4 w-4" />{' '}
              {submit.isPending ? 'Sending…' : 'Submit report'}
            </button>
            {!!missing.length && (
              <p className="text-center text-xs text-ink-500">
                Still needed: {missing.join(', ')}
              </p>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
