/**
 * Leave an echo. No microphone: the visitor draws a slow gesture, and its
 * shape becomes a waveform — the sideways deviation of the path from its own
 * main direction. The archive keeps it in this browser (localStorage) and,
 * on the next descent, it is the newest stratum of the drawing: TR—31.
 */
export interface Echo {
  date: string
  /** 64 samples, −1..1 — the gesture's profile. */
  wave: number[]
}

const KEY = 'tidal-archive:echo'

export function loadEcho(): Echo | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const e = JSON.parse(raw) as Echo
    return Array.isArray(e.wave) && e.wave.length === 64 && typeof e.date === 'string' ? e : null
  } catch {
    return null
  }
}

export function saveEcho(e: Echo) {
  try {
    localStorage.setItem(KEY, JSON.stringify(e))
  } catch {
    // storage blocked (private mode): the echo lasts only for this visit
  }
}

export function forgetEcho() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing kept */
  }
}

/** Live state of the drawing gesture while the visitor leaves an echo. */
export const echoGesture = {
  /** 'off' → 'ready' (waiting for the press) → 'drawing' → 'off' */
  mode: 'off' as 'off' | 'ready' | 'drawing',
  points: [] as { x: number; y: number }[],
  started: 0,
}

export const ECHO_MAX_SECONDS = 6

/** The gesture's profile across its own principal direction, as 64 samples. */
export function gestureToWave(pts: { x: number; y: number }[]): number[] | null {
  if (pts.length < 10) return null
  // resample by arc length
  const lens = [0]
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const total = lens[lens.length - 1]
  if (total < 60) return null
  const N = 128
  const rs: { x: number; y: number }[] = []
  let j = 0
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1)) * total
    while (j < lens.length - 2 && lens[j + 1] < s) j++
    const t = (s - lens[j]) / Math.max(1e-6, lens[j + 1] - lens[j])
    rs.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, y: pts[j].y + (pts[j + 1].y - pts[j].y) * t })
  }
  // principal axis of the points
  let mx = 0, my = 0
  for (const p of rs) {
    mx += p.x
    my += p.y
  }
  mx /= N
  my /= N
  let sxx = 0, syy = 0, sxy = 0
  for (const p of rs) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const nx = -Math.sin(ang)
  const ny = Math.cos(ang)
  // sideways deviation, with the straight trend removed and both ends pinned to zero
  const across = rs.map((p) => (p.x - mx) * nx + (p.y - my) * ny)
  const a0 = across[0]
  const a1 = across[N - 1]
  const prof = across.map((v, i) => v - (a0 + ((a1 - a0) * i) / (N - 1)))
  const peak = Math.max(1e-6, ...prof.map(Math.abs))
  const out: number[] = []
  for (let i = 0; i < 64; i++) {
    const v = prof[Math.round((i / 63) * (N - 1))] / peak
    const taper = Math.sin((Math.PI * i) / 63) ** 0.5
    out.push(Math.round(v * taper * 1000) / 1000)
  }
  return out
}

/** Harmonic recipe for a PeriodicWave: the gesture is heard as one period of a tone. */
export function waveHarmonics(wave: number[], count = 24) {
  const real = new Float32Array(count + 1)
  const imag = new Float32Array(count + 1)
  const n = wave.length
  for (let h = 1; h <= count; h++) {
    let re = 0, im = 0
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * h * i) / n
      re += wave[i] * Math.cos(a)
      im += wave[i] * Math.sin(a)
    }
    // soften the upper partials so every gesture stays a voice, not a buzz
    const soft = 1 / (1 + h * 0.25)
    real[h] = (re / n) * soft
    imag[h] = (im / n) * soft
  }
  return { real, imag }
}
