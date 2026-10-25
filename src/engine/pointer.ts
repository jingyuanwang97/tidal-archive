import { clamp, damp } from './math'

/**
 * Shared pointer state. Raw input is written by listeners; the smoothed
 * values are advanced once per frame by the engine loop, so the cursor trail
 * and the artwork read exactly the same motion.
 */
export const pointer = {
  x: -9999,
  y: -9999,
  /** Smoothed (inertial) position used by the artwork field. */
  sx: -9999,
  sy: -9999,
  /** Velocity of the raw pointer, px/s, lightly filtered. */
  vx: 0,
  vy: 0,
  speed: 0,
  /** 0..1 — rises with movement, decays when the pointer rests. */
  energy: 0,
  /** Seconds since the last move. */
  idle: 99,
  inside: false,
  hasMoved: false,
  /** True while hovering an interactive element. */
  overTarget: false,
  fine: typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
  /** A finger is on the screen (touch devices). */
  touching: false,
  /** Recent taps, newest last; each has a rising id so readers can tell what is new. */
  taps: [] as { id: number; x: number; y: number; t: number }[],
}

let tapId = 0

let lastX = 0
let lastY = 0
let lastT = 0
let pendingVX = 0
let pendingVY = 0

export function attachPointer(): () => void {
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    const now = performance.now()
    const dt = Math.max(1, now - lastT) / 1000
    if (pointer.hasMoved) {
      pendingVX = (e.clientX - lastX) / dt
      pendingVY = (e.clientY - lastY) / dt
    } else {
      pointer.sx = e.clientX
      pointer.sy = e.clientY
    }
    lastX = e.clientX
    lastY = e.clientY
    lastT = now
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.idle = 0
    pointer.inside = true
    pointer.hasMoved = true
    const t = e.target as Element | null
    pointer.overTarget = !!t?.closest?.('a, button, [data-cursor="target"]')
  }
  const onLeave = (e: Event) => {
    // a swipe hands the touch to native scrolling (pointercancel → pointerleave),
    // but the finger is still there; touch presence is tracked by touch events
    if ((e as PointerEvent).pointerType === 'touch') return
    pointer.inside = false
  }
  // Touch: tracked with passive touch events, which keep arriving while the
  // page scrolls natively — so a swipe can leave ink without ever blocking it.
  let touchStartX = 0
  let touchStartY = 0
  let touchStartT = 0
  const place = (t: Touch, now: number) => {
    const dt = Math.max(1, now - lastT) / 1000
    if (pointer.touching) {
      pendingVX = (t.clientX - lastX) / dt
      pendingVY = (t.clientY - lastY) / dt
    } else {
      pointer.sx = t.clientX
      pointer.sy = t.clientY
      pendingVX = pendingVY = 0
    }
    lastX = t.clientX
    lastY = t.clientY
    lastT = now
    pointer.x = t.clientX
    pointer.y = t.clientY
    pointer.idle = 0
    pointer.hasMoved = true
  }
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    const now = performance.now()
    place(t, now)
    pointer.touching = true
    pointer.inside = true
    touchStartX = t.clientX
    touchStartY = t.clientY
    touchStartT = now
  }
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0]
    if (t) place(t, performance.now())
  }
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length) return
    const now = performance.now()
    const moved = Math.hypot(pointer.x - touchStartX, pointer.y - touchStartY)
    if (moved < 12 && now - touchStartT < 320) {
      pointer.taps.push({ id: ++tapId, x: pointer.x, y: pointer.y, t: now })
      if (pointer.taps.length > 8) pointer.taps.shift()
    }
    pointer.touching = false
    pointer.inside = false
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  window.addEventListener('blur', onLeave)
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  window.addEventListener('touchcancel', onTouchEnd, { passive: true })
  return () => {
    window.removeEventListener('pointermove', onMove)
    document.documentElement.removeEventListener('pointerleave', onLeave)
    window.removeEventListener('blur', onLeave)
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchEnd)
  }
}

export function updatePointer(dt: number) {
  pointer.idle += dt
  // Velocity is sampled from events; let it fade when events stop arriving.
  if (pointer.idle > 0.05) {
    pendingVX *= Math.exp(-14 * dt)
    pendingVY *= Math.exp(-14 * dt)
  }
  pointer.vx = damp(pointer.vx, pendingVX, 18, dt)
  pointer.vy = damp(pointer.vy, pendingVY, 18, dt)
  pointer.speed = Math.hypot(pointer.vx, pointer.vy)
  pointer.sx = damp(pointer.sx, pointer.x, 7, dt)
  pointer.sy = damp(pointer.sy, pointer.y, 7, dt)
  const targetEnergy = clamp(pointer.speed / 1600)
  pointer.energy = damp(pointer.energy, targetEnergy, targetEnergy > pointer.energy ? 8 : 1.6, dt)
}
