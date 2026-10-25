/**
 * Hold to listen. A press arms for a moment (so a plain click does nothing),
 * then listening starts and lasts until release. Touch holds are cancelled
 * if the finger starts to scroll. Keyboard: hold "L".
 */
export type ListenTarget = { kind: 'record'; line: number } | { kind: 'still' }

export const listen = {
  pressing: false,
  /** 0..1 — progress of the press toward listening. */
  armed: 0,
  active: false,
  /** Eased 0..1 presence of the listen, for the drawing. */
  strength: 0,
  /** RMS of the held voice, normalized. */
  level: 0,
  /** Waveform of the held voice, peak-normalized to about ±1. */
  wave: new Float32Array(2048),
  target: null as ListenTarget | null,
  x: 0,
  y: 0,
  source: 'pointer' as 'pointer' | 'key',
  touch: false,
}

const ARM_MOUSE = 0.22
const ARM_TOUCH = 0.38

export const armTime = () => (listen.source === 'key' ? 0.01 : listen.touch ? ARM_TOUCH : ARM_MOUSE)

export function attachListen(opts: { blocked: () => boolean; onGesture: () => void }): () => void {
  let sx = 0
  let sy = 0
  let id = -1

  const ignore = (e: Event) => {
    const t = e.target as Element | null
    return !!t?.closest?.('a, button, input, [data-no-listen]')
  }

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || opts.blocked() || ignore(e)) return
    opts.onGesture()
    id = e.pointerId
    sx = e.clientX
    sy = e.clientY
    listen.x = e.clientX
    listen.y = e.clientY
    listen.touch = e.pointerType !== 'mouse'
    listen.source = 'pointer'
    listen.pressing = true
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id || !listen.pressing) return
    listen.x = e.clientX
    listen.y = e.clientY
    // a finger that travels before listening starts is scrolling, not listening
    if (listen.touch && !listen.active && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) listen.pressing = false
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    listen.pressing = false
    id = -1
    // touch only counts as a user activation on release
    if (listen.touch) opts.onGesture()
  }
  const keyDown = (e: KeyboardEvent) => {
    if (e.repeat || (e.key !== 'l' && e.key !== 'L') || opts.blocked()) return
    if ((e.target as Element | null)?.closest?.('input, textarea')) return
    opts.onGesture()
    listen.source = 'key'
    listen.touch = false
    listen.pressing = true
  }
  const keyUp = (e: KeyboardEvent) => {
    if ((e.key === 'l' || e.key === 'L') && listen.source === 'key') listen.pressing = false
  }
  const menu = (e: Event) => {
    if (listen.pressing || listen.active) e.preventDefault()
  }

  window.addEventListener('pointerdown', down)
  window.addEventListener('pointermove', move, { passive: true })
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('contextmenu', menu)
  return () => {
    window.removeEventListener('pointerdown', down)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    window.removeEventListener('keydown', keyDown)
    window.removeEventListener('keyup', keyUp)
    window.removeEventListener('contextmenu', menu)
  }
}
