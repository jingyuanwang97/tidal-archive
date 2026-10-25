/**
 * A true tide clock. The principal tide, M2, follows the Moon: two high waters
 * per lunar day, one every 12 h 25 min. Its phase is twice the Moon's hour
 * angle at the site, plus the site's lag. The Moon's position uses the usual
 * low-precision formulas (good to about a degree), so the hand on the drawing
 * points where the Moon has actually put the tide, right now.
 */
const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const J1970 = 2440587.5
const J2000 = 2451545

/** M2 period, in milliseconds (12.4206 h). */
export const M2_PERIOD = 12.4206012 * 3_600_000

/** Amphidrome Nº 07, a fictional station in the South Pacific. */
export const STATION = { lat: -47.2, lng: -151.667, lag: 0.6 }

function lunarHourAngle(date: Date, lng: number) {
  const d = date.getTime() / DAY_MS + J1970 - J2000
  const L = RAD * (218.316 + 13.176396 * d) // mean ecliptic longitude
  const M = RAD * (134.963 + 13.064993 * d) // mean anomaly
  const F = RAD * (93.272 + 13.22935 * d) // mean distance from the node
  const lon = L + RAD * 6.289 * Math.sin(M)
  const lat = RAD * 5.128 * Math.sin(F)
  const e = RAD * 23.4397 // obliquity of the ecliptic
  const ra = Math.atan2(Math.sin(lon) * Math.cos(e) - Math.tan(lat) * Math.sin(e), Math.cos(lon))
  const sidereal = RAD * (280.16 + 360.9856235 * d) + RAD * lng
  return sidereal - ra
}

/** M2 phase at the station, 0..2π; 0 is high water at the 00 bearing. */
export function m2Phase(date = new Date()) {
  const p = 2 * lunarHourAngle(date, STATION.lng) - STATION.lag
  return ((p % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

/** The next high water at the station, as a local clock time "HH:MM". */
export function nextHighWater(date = new Date()) {
  const frac = m2Phase(date) / (2 * Math.PI)
  const next = new Date(date.getTime() + (1 - frac) * M2_PERIOD)
  return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
}
