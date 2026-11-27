import { Camera, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function PhotoDropzone({ file, onChange, label }: {
  file: File | null
  onChange: (file: File | null) => void
  label?: string
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (files: FileList | null) => {
    const f = files?.[0]
    if (f && f.type.startsWith('image/')) onChange(f)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        pick(e.dataTransfer.files)
      }}
      className={`relative overflow-hidden rounded-xl border-2 border-dashed transition ${
        dragging ? 'border-ink-500 bg-ink-50' : preview ? 'border-transparent' : 'border-ink-200 bg-white hover:border-ink-300'
      }`}
    >
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
      {preview ? (
        <div className="group relative aspect-[4/3]">
          <img src={preview} alt={t('photo.selectedAlt')} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="btn absolute bottom-3 right-3 bg-white/95 text-ink-800 shadow-card hover:bg-white"
            aria-label={t('a11y.replacePhoto')}
          >
            <RefreshCw aria-hidden className="h-4 w-4" /> {t('photo.replace')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 text-center"
        >
          <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-white">
            <Camera aria-hidden className="h-6 w-6" />
          </span>
          <span className="text-sm font-semibold text-ink-900">{label ?? t('photo.addPhoto')}</span>
          <span className="text-xs text-ink-500">{t('photo.hint')}</span>
        </button>
      )}
    </div>
  )
}
