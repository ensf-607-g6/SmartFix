import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect } from 'react'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import { ACCENT, severityColor } from '../lib/format'

export const CALGARY: [number, number] = [51.0447, -114.0719]

const TILE_URL = 'https://{s}.basemap.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'

export function BaseMap({ center = CALGARY, zoom = 12, children, className = 'h-full w-full' }: {
  center?: [number, number]
  zoom?: number
  children?: React.ReactNode
  className?: string
}) {
  return (
    <MapContainer center={center} zoom={zoom} className={className} zoomControl={false} scrollWheelZoom>
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
      {/* Bottom-right keeps the zoom buttons clear of the overlays pages put along the top. */}
      <ZoomControl position="bottomright" />
      {children}
    </MapContainer>
  )
}

/** Navy teardrop pin for "the place you picked". */
export const pinIcon = L.divIcon({
  className: '',
  html: `<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 43C17 43 32 27.5 32 16.5C32 8 25.3 1.5 17 1.5C8.7 1.5 2 8 2 16.5C2 27.5 17 43 17 43Z" fill="#13213C" stroke="white" stroke-width="2"/>
    <circle cx="17" cy="16.5" r="6" fill="${ACCENT}"/></svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 43],
})

export function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

export function FlyTo({ position, zoom }: { position: [number, number] | null; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.flyTo(position, zoom ?? Math.max(map.getZoom(), 15), { duration: 0.6 })
  }, [position, zoom, map])
  return null
}

export function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15)
    else if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 })
  }, [key, map])
  return null
}

/**
 * One issue on a map. Severity is shown twice (navy shade and radius) so it never relies on
 * colour alone; escalated issues get an amber ring, the one "act now" colour.
 */
export function IssueMarker({ lat, lng, severity, escalated, selected, label, onClick }: {
  lat: number
  lng: number
  severity: number | null
  escalated?: boolean
  selected?: boolean
  label?: string
  onClick?: () => void
}) {
  const radius = 6 + (severity ?? 1) * 1.6
  return (
    <>
      {(escalated || selected) && (
        <CircleMarker
          center={[lat, lng]}
          radius={radius + 6}
          pathOptions={{ color: escalated ? ACCENT : '#13213C', weight: 3, fillOpacity: 0, opacity: 0.9 }}
          interactive={false}
        />
      )}
      <CircleMarker
        center={[lat, lng]}
        radius={radius}
        pathOptions={{ color: '#FFFFFF', weight: 2, fillColor: severityColor(severity), fillOpacity: 1 }}
        eventHandlers={onClick ? { click: onClick } : undefined}
      >
        {label && (
          <Tooltip direction="top" offset={[0, -radius]} opacity={1}>
            <span className="text-xs font-medium">{label}</span>
          </Tooltip>
        )}
      </CircleMarker>
    </>
  )
}

export function PlacedPin({ lat, lng }: { lat: number; lng: number }) {
  return <Marker position={[lat, lng]} icon={pinIcon} />
}

export function SeverityLegend() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/95 px-3 py-2 text-[11px] font-medium text-ink-600 shadow-card">
      <span>Severity</span>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span
            className="inline-block rounded-full border-2 border-white"
            style={{ background: severityColor(s), width: 8 + s * 2, height: 8 + s * 2 }}
          />
          {s}
        </span>
      ))}
      <span className="ml-1 flex items-center gap-1">
        <span className="inline-block h-3.5 w-3.5 rounded-full border-[3px]" style={{ borderColor: ACCENT }} />
        Escalated
      </span>
    </div>
  )
}
