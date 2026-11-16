import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, type ReactNode } from 'react'
import {
  MapContainer,
  CircleMarker,
  Marker,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { severityColor } from '../lib/format'

const CALGARY: [number, number] = [51.0447, -114.0719]
const TILE_URL =
  'https://{s}.basemap.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'

const pinIcon = L.divIcon({
  className: '',
  html: `<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 43C17 43 32 27.5 32 16.5C32 8 25.3 1.5 17 1.5C8.7 1.5 2 8 2 16.5C2 27.5 17 43 17 43Z" fill="#13213C" stroke="white" stroke-width="2"/>
    <circle cx="17" cy="16.5" r="6" fill="#F6B73C"/></svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 43],
})

export function BaseMap({
  center = CALGARY,
  zoom = 12,
  children,
}: {
  center?: [number, number]
  zoom?: number
  children?: ReactNode
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className="h-full w-full"
      zoomControl={false}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
      <ZoomControl position="bottomright" />
      {children}
    </MapContainer>
  )
}

export function ClickToPlace({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click: (event) => onPick(event.latlng.lat, event.latlng.lng),
  })
  return null
}

export function FlyTo({ position }: { position: [number, number] | null }) {
  const map = useMap()

  useEffect(() => {
    if (position) {
      map.flyTo(position, Math.max(map.getZoom(), 15), { duration: 0.6 })
    }
  }, [map, position])

  return null
}

export function PlacedPin({ lat, lng }: { lat: number; lng: number }) {
  return <Marker position={[lat, lng]} icon={pinIcon} />
}

export function IssueMarker({
  lat,
  lng,
  severity,
  escalated,
  selected,
  label,
  onClick,
}: {
  lat: number
  lng: number
  severity: number | null
  escalated?: boolean
  selected?: boolean
  label?: string
  onClick?: () => void
}) {
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={6 + (severity ?? 1) * 1.6}
      pathOptions={{
        color: escalated ? '#F6B73C' : selected ? '#13213C' : '#FFFFFF',
        weight: escalated || selected ? 4 : 2,
        fillColor: severityColor(severity),
        fillOpacity: 1,
      }}
      eventHandlers={onClick ? { click: onClick } : undefined}
    >
      {label && <Tooltip direction="top">{label}</Tooltip>}
    </CircleMarker>
  )
}

export function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  const key = points.map((point) => point.join(',')).join('|')

  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15)
    else if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 15 })
    }
    // The coordinate key changes when the actual point set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])

  return null
}

export function SeverityLegend() {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-xs font-medium text-ink-600 shadow-card">
      <span>Severity</span>
      {[1, 2, 3, 4, 5].map((value) => (
        <span key={value} className="flex items-center gap-1">
          <span
            className="inline-block rounded-full border border-white"
            style={{
              background: severityColor(value),
              width: 8 + value * 2,
              height: 8 + value * 2,
            }}
          />
          {value}
        </span>
      ))}
    </div>
  )
}
