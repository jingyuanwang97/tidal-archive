import { pointer } from './pointer'
import { listen } from './listen'
import { echoGesture } from './echo'
import { clamp, damp, lerp } from './math'
import { type Palette, type RGB, rgba } from './palette'

/**
 * The liquid cursor: a tapered ribbon of ink.
 *
 * Each sample is emitted at the pointer with a share of the pointer's velocity,
 * then keeps drifting under drag. On a sharp turn the older samples carry on
 * along the previous heading, so the ribbon bends instead of snapping. Samples
 * are also drawn toward their newer neighbour, so when the pointer rests the
 * tail retracts into the head and disappears rather than lingering.
 */

interface Sample {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  w: number
}

const MAX_SAMPLES = 46

export class LiquidCursor {
  private ctx: CanvasRenderingContext2D
  private samples: Sample[] = []
  private lastX = 0
  private lastY = 0
  private primed = false
  private ring = 10
  private presence = 0
  private W = 1
  private H = 1
  private dpr = 1

  // scratch buffers for the outline
  private lx = new Float32Array(MAX_SAMPLES + 2)
  private ly = new Float32Array(MAX_SAMPLES + 2)
  private rx = new Float32Array(MAX_SAMPLES + 2)
  private ry = new Float32Array(MAX_SAMPLES + 2)

  constructor(
    private canvas: HTMLCanvasElement,
    private pal: Palette,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.ctx = ctx
  }

  setPalette(p: Palette) {
    this.pal = p
  }

  resize(W: number, H: number, dpr: number) {
    this.W = W
    this.H = H
    this.dpr = dpr
    this.canvas.width = Math.round(W * dpr)
    this.canvas.height = Math.round(H * dpr)
    this.canvas.style.width = `${W}px`
    this.canvas.style.height = `${H}px`
  }

  private emit(x: number, y: number) {
    const speed = pointer.speed
    const sp = clamp(speed / 2000)
    this.samples.push({
      x,
      y,
      vx: pointer.vx * 0.22,
      vy: pointer.vy * 0.22,
      life: 0,
      max: lerp(0.4, 0.95, sp),
      w: lerp(5, 44, Math.pow(sp, 0.75)),
    })
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
  }

  update(dt: number) {
    const live = pointer.hasMoved && (pointer.inside || pointer.touching)
    this.presence = damp(this.presence, live ? 1 : 0, 6, dt)

    if (live) {
      if (!this.primed) {
        this.lastX = pointer.x
        this.lastY = pointer.y
        this.primed = true
      }
      const dx = pointer.x - this.lastX
      const dy = pointer.y - this.lastY
      const dist = Math.hypot(dx, dy)
      if (dist > 1.5) {
        // subdivide fast moves so the ribbon never shows straight chords
        const steps = clamp(Math.ceil(dist / 16), 1, 5)
        for (let s = 1; s <= steps; s++) this.emit(this.lastX + (dx * s) / steps, this.lastY + (dy * s) / steps)
        this.lastX = pointer.x
        this.lastY = pointer.y
      }
    } else {
      this.primed = false
    }

    const S = this.samples
    for (let i = 0; i < S.length; i++) {
      const p = S[i]
      p.life += dt
      const drag = Math.exp(-4.2 * dt)
      p.vx *= drag
      p.vy *= drag
      p.x += p.vx * dt
      p.y += p.vy * dt
      // cohesion toward the newer neighbour (or the live pointer for the newest)
      const nx = i < S.length - 1 ? S[i + 1].x : pointer.x
      const ny = i < S.length - 1 ? S[i + 1].y : pointer.y
      const pull = clamp(dt * (1.2 + 5 * (p.life / p.max)))
      p.x += (nx - p.x) * pull
      p.y += (ny - p.y) * pull
    }
    while (S.length && S[0].life >= S[0].max) S.shift()

    const ringTarget = listen.active ? 15 + listen.level * 26 : pointer.overTarget ? 22 : 10
    this.ring = damp(this.ring, ringTarget, listen.active ? 18 : 12, dt)
  }

  render(dt: number, water: { top: Path2D; bottom: Path2D } | null, waterRatio: number) {
    this.update(dt)
    const { ctx, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.W, this.H)
    const now = performance.now()
    const taps = pointer.taps.some((t) => now - t.t < TAP_LIFE * 1000)
    if (this.presence < 0.01 && !taps) return

    const above = this.pal.surfaceInk
    const below = this.pal.deepInk
    if (water) {
      ctx.save()
      ctx.clip(water.top)
      this.draw(above)
      ctx.restore()
      ctx.save()
      ctx.clip(water.bottom)
      this.draw(below)
      ctx.restore()
    } else {
      this.draw(waterRatio >= 0.5 ? below : above)
    }
  }

  private draw(ink: RGB) {
    const { ctx, pal } = this
    const S = this.samples
    const count = S.length + 1
    const a = this.presence

    if (count >= 3) {
      // gather points (oldest → newest → live pointer) and widths
      const lx = this.lx, ly = this.ly, rx = this.rx, ry = this.ry
      const px = (i: number) => (i < S.length ? S[i].x : pointer.x)
      const py = (i: number) => (i < S.length ? S[i].y : pointer.y)
      for (let i = 0; i < count; i++) {
        const i0 = Math.max(0, i - 1)
        const i1 = Math.min(count - 1, i + 1)
        let tx = px(i1) - px(i0)
        let ty = py(i1) - py(i0)
        const tl = Math.hypot(tx, ty) || 1
        tx /= tl
        ty /= tl
        const s = i < S.length ? S[i] : S[S.length - 1]
        const lifeK = i < S.length ? 1 - s.life / s.max : 1
        const along = i / (count - 1)
        // thin at the tail, full through the body, softly pinched at the head
        const taper = Math.pow(along, 0.85) * (1 - 0.45 * Math.pow(along, 6))
        const w = s.w * Math.pow(clamp(lifeK), 0.7) * taper * 0.5
        lx[i] = px(i) - ty * w
        ly[i] = py(i) + tx * w
        rx[i] = px(i) + ty * w
        ry[i] = py(i) - tx * w
      }

      ctx.beginPath()
      ctx.moveTo(lx[0], ly[0])
      for (let i = 1; i < count - 1; i++) {
        ctx.quadraticCurveTo(lx[i], ly[i], (lx[i] + lx[i + 1]) / 2, (ly[i] + ly[i + 1]) / 2)
      }
      ctx.lineTo(lx[count - 1], ly[count - 1])
      ctx.lineTo(rx[count - 1], ry[count - 1])
      for (let i = count - 2; i > 0; i--) {
        ctx.quadraticCurveTo(rx[i], ry[i], (rx[i] + rx[i - 1]) / 2, (ry[i] + ry[i - 1]) / 2)
      }
      ctx.lineTo(rx[0], ry[0])
      ctx.closePath()

      // translucent body, inked contour — the same hairline as the artwork;
      // while an echo is being drawn, the ink is the accent
      const drawingEcho = echoGesture.mode === 'drawing'
      ctx.fillStyle = drawingEcho ? rgba(pal.accentGlow, 0.24 * a) : rgba(ink, 0.2 * a)
      ctx.fill()
      ctx.lineJoin = 'round'
      ctx.lineWidth = 0.9
      ctx.strokeStyle = rgba(drawingEcho ? pal.accentGlow : ink, 0.7 * a)
      ctx.stroke()

      // a denser core along the spine, in the accent ink
      ctx.beginPath()
      ctx.moveTo(px(0), py(0))
      for (let i = 1; i < count - 1; i++) {
        ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2)
      }
      ctx.lineTo(px(count - 1), py(count - 1))
      ctx.lineCap = 'round'
      ctx.lineWidth = 1.2
      ctx.strokeStyle = rgba(pal.accent, 0.85 * a)
      ctx.stroke()
    }

    this.drawTaps(ink)

    // on touch screens: no reticle, only the listening ring around the finger
    if (!pointer.fine) {
      if (listen.armed > 0.01 || listen.active) {
        const r = 30 + (listen.active ? listen.level * 24 : 0)
        ctx.beginPath()
        ctx.arc(pointer.x, pointer.y, r, -Math.PI / 2, -Math.PI / 2 + (listen.active ? 1 : listen.armed) * Math.PI * 2)
        ctx.lineWidth = 1.2
        ctx.strokeStyle = rgba(pal.accent, 0.9 * Math.max(a, 0.6))
        ctx.stroke()
      }
      return
    }

    // the exact pointer position: a fine reticle
    if (pointer.hasMoved) {
      ctx.beginPath()
      ctx.arc(pointer.x, pointer.y, this.ring, 0, Math.PI * 2)
      ctx.lineWidth = 0.9
      ctx.strokeStyle = rgba(listen.active ? pal.accent : ink, 0.85 * a)
      ctx.stroke()
      // a press arms before it listens: the arc fills, then the ring breathes with the sound
      if (listen.armed > 0.01 && !listen.active && listen.source === 'pointer') {
        ctx.beginPath()
        ctx.arc(pointer.x, pointer.y, this.ring + 5, -Math.PI / 2, -Math.PI / 2 + listen.armed * Math.PI * 2)
        ctx.lineWidth = 1.2
        ctx.strokeStyle = rgba(pal.accent, 0.9 * a)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(pointer.x, pointer.y, 1.7, 0, Math.PI * 2)
      ctx.fillStyle = rgba(pal.accent, a)
      ctx.fill()
    }
  }

  /** A tap is a drop on water: a bead of ink and three hairline rings spreading out. */
  private drawTaps(ink: RGB) {
    const { ctx, pal } = this
    const now = performance.now()
    for (const tap of pointer.taps) {
      const age = (now - tap.t) / 1000
      if (age > TAP_LIFE) continue
      const k = age / TAP_LIFE
      const fade = (1 - k) * (1 - k)
      for (let r = 0; r < 3; r++) {
        const rr = 4 + (1 - Math.pow(1 - k, 2.2)) * (54 + r * 30) * (1 - r * 0.08)
        ctx.beginPath()
        ctx.arc(tap.x, tap.y, rr, 0, Math.PI * 2)
        ctx.lineWidth = r === 0 ? 1.1 : 0.7
        ctx.strokeStyle = rgba(r === 0 ? pal.accent : ink, (r === 0 ? 0.9 : 0.55 - r * 0.12) * fade)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(tap.x, tap.y, 3.2 * (1 - k), 0, Math.PI * 2)
      ctx.fillStyle = rgba(pal.accent, fade)
      ctx.fill()
    }
  }
}

const TAP_LIFE = 1.2
