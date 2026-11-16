import { Camera, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function PhotoDropzone({
  file,
  onChange,
  label = 'Add a photo of the problem',
}: {
  file: File | null
  onChange: (file: File | null) => void
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setError('Choose an image file.')
      return
    }
    if (f.size > 15 * 1024 * 1024) {
      setError('The photo must be 15 MB or smaller.')
      return
    }
    setError(null)
    onChange(f)
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
        error
          ? 'border-danger-600 bg-danger-50'
          : dragging
            ? 'border-ink-500 bg-ink-50'
            : preview
              ? 'border-transparent'
              : 'border-ink-200 bg-white hover:border-ink-300'
      }`}
    >
      {error && (
        <span
          className="absolute left-3 top-3 z-10 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-danger-700 shadow-card"
          role="alert"
        >
          {error}
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          pick(event.target.files)
          event.target.value = ''
        }}
      />
      {preview ? (
        <div className="group relative aspect-[4/3]">
          <img
            src={preview}
            alt="Selected"
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="btn absolute bottom-3 right-3 bg-white/95 text-ink-800 shadow-card hover:bg-white"
          >
            <RefreshCw className="h-4 w-4" /> Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 text-center"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-white">
            <Camera className="h-6 w-6" />
          </span>
          <span className="text-sm font-semibold text-ink-900">{label}</span>
          <span className="text-xs text-ink-500">
            Drag an image here or click to choose · JPG, PNG, up to 15 MB
          </span>
        </button>
      )}
    </div>
  )
}
