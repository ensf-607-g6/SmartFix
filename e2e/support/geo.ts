/** Points used by the tests. Service-area boxes come from backend/scripts/init_db.py. */
export interface Point {
  lat: number
  lng: number
}

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

/** A random point inside Calgary's service areas (well away from the box edges). */
export function calgaryPoint(): Point {
  return { lat: Number(between(50.9, 51.17).toFixed(6)), lng: Number(between(-114.28, -113.9).toFixed(6)) }
}

/** A random point inside the "Downtown" service area. */
export function downtownPoint(): Point {
  return { lat: Number(between(51.038, 51.053).toFixed(6)), lng: Number(between(-114.095, -114.045).toFixed(6)) }
}

/** Edmonton: outside every Calgary service area (TC-017). */
export function outsideServiceAreas(): Point {
  return { lat: Number(between(53.52, 53.56).toFixed(6)), lng: Number(between(-113.53, -113.47).toFixed(6)) }
}

/** A point `metres` north of `p` (1 degree of latitude is about 111 km). */
export function metresNorthOf(p: Point, metres: number): Point {
  return { lat: Number((p.lat + metres / 111_320).toFixed(6)), lng: p.lng }
}
