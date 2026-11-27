import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Crosshair, MapPin, Send } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { ProblemType } from '../../api/types'
import { PhotoDropzone } from '../../components/PhotoDropzone'
import { ProblemIcon } from '../../components/ProblemIcon'
import { BaseMap, ClickToPlace, FlyTo, PlacedPin } from '../../components/maps'
import { ErrorNote, Field, PageHeader } from '../../components/ui'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

interface Accepted {
  report_id: string
  issue_id: string
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`)
    const data = await r.json()
    const a = data.address ?? {}
    const street = [a.house_number, a.road].filter(Boolean).join(' ')
    return [street, a.neighbourhood ?? a.suburb].filter(Boolean).join(', ') || data.display_name || null
  } catch {
    return null
  }
}

export function NewReportPage() {
  const { t } = useTranslation()
  const ids = { mapHelp: useId(), category: useId(), missing: useId() }
  useDocumentTitle(t('newReport.title'))
  const queryClient = useQueryClient()
  const { data: types = [] } = useQuery({
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
    const t = setTimeout(async () => {
      const found = await reverseGeocode(pin[0], pin[1])
      if (!cancelled && found) setAddress(found)
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-reports'] }),
  })

  const locate = () => {
    if (!navigator.geolocation) return setLocError(t('newReport.noGeolocation'))
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
        setLocError(t('newReport.locationBlocked'))
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const missing = [
    !photo && t('newReport.missingPhoto'),
    !pin && t('newReport.missingPin'),
    !category && t('newReport.missingCategory'),
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
        <div className="card p-10 text-center" role="status">
          <CheckCircle2 aria-hidden className="mx-auto h-14 w-14 text-ink-900" />
          <h1 className="mt-5 text-2xl font-bold">{t('newReport.receivedTitle')}</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
            {t('newReport.receivedBody')}
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to={`/resident/reports/${submit.data.report_id}`} className="btn-primary">
              {t('newReport.track')}
            </Link>
            <button onClick={reset} className="btn-secondary">
              {t('newReport.reportAnother')}
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
    <div className="px-8 py-8">
      <PageHeader title={t('newReport.title')} subtitle={t('newReport.subtitle')} />
      <form onSubmit={onSubmit} className="grid grid-cols-[1fr_440px] gap-6">
        <div className="card relative h-[calc(100vh-13rem)] min-h-[560px] overflow-hidden">
          <BaseMap label={t('a11y.mapReport')} describedBy={ids.mapHelp}>
            <ClickToPlace onPick={(lat, lng) => setPin([lat, lng])} />
            <FlyTo position={flyTo} />
            {pin && <PlacedPin lat={pin[0]} lng={pin[1]} />}
          </BaseMap>
          <p id={ids.mapHelp} className="sr-only">
            {t('a11y.mapReportHelp')}
          </p>
          <div className="pointer-events-none absolute left-4 right-4 top-4 z-[500] flex items-start justify-between gap-3">
            <div
              className="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-ink-800 shadow-card"
              aria-live="polite"
            >
              <MapPin aria-hidden className="h-4 w-4 text-ink-500" />
              {pin ? t('newReport.pinPlaced') : t('newReport.clickMap')}
            </div>
            <button type="button" onClick={locate} className="btn-dark pointer-events-auto shadow-card" disabled={locating}>
              <Crosshair aria-hidden className="h-4 w-4" /> {locating ? t('newReport.findingYou') : t('newReport.useMyLocation')}
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
            <span className="label">{t('newReport.stepPhoto')}</span>
            <PhotoDropzone file={photo} onChange={setPhoto} />
          </div>

          <div>
            <span id={ids.category} className="label">
              {t('newReport.stepCategory')}
            </span>
            <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby={ids.category}>
              {types.map((t) => {
                const on = category === t.code
                return (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => setCategory(t.code)}
                    aria-pressed={on}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition ${
                      on ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-100 bg-white text-ink-700 hover:border-ink-300'
                    }`}
                  >
                    <ProblemIcon code={t.code} className="h-5 w-5" />
                    <span className="text-center leading-tight">{t.display_name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            <span className="label">{t('newReport.stepDetails')}</span>
            <Field label={t('newReport.location')}>
              <input
                className="input"
                placeholder={pin ? t('newReport.locationLookingUp') : t('newReport.locationPlaceholder')}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={300}
              />
            </Field>
            <Field label={t('newReport.description')}>
              <textarea
                className="input min-h-[84px] resize-none"
                placeholder={t('newReport.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
            </Field>
          </div>

          <div className="mt-auto space-y-3">
            {submit.isError && <ErrorNote>{(submit.error as Error).message}</ErrorNote>}
            <button
              className="btn-primary w-full py-3 text-base"
              disabled={!!missing.length || submit.isPending}
              aria-describedby={missing.length ? ids.missing : undefined}
            >
              <Send aria-hidden className="h-4 w-4" /> {submit.isPending ? t('newReport.sending') : t('newReport.submit')}
            </button>
            {!!missing.length && <p id={ids.missing} className="text-center text-xs text-ink-500">{t('newReport.stillNeeded', { items: missing.join(t('newReport.listSeparator')) })}</p>}
          </div>
        </div>
      </form>
    </div>
  )
}
