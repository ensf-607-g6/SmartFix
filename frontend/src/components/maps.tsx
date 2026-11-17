import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, type ReactNode } from 'react'
import {
  MapContainer,
  CircleMarker,
  Marker,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'

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
}: {
  lat: number
  lng: number
  severity: number | null
  escalated?: boolean
}) {
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={6 + (severity ?? 1) * 1.6}
      pathOptions={{
        color: escalated ? '#F6B73C' : '#FFFFFF',
        weight: escalated ? 4 : 2,
        fillColor: '#13213C',
        fillOpacity: 1,
      }}
    />
  )
}
