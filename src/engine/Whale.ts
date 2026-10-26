import { clamp, easeInOutSine, easeOutCubic, lerp, smoothstep } from './math'
import { type Palette, type RGB, mix, rgba } from './palette'

/**
 * A whale, far off — the hidden sighting of chapter 01.
 *
 * Someone who lingers at the surface may, once in a while, see a whale on a
 * distant stretch of sea in the fog between the opening words and the title:
 * a faint horizon appears, something breaks it, and it is gone. It is drawn in
 * the same language as the rest of the piece — translucent ink with a hairline
 * edge, hazed toward the fog by distance — and only what is above the water
 * is visible. Nothing announces it; most visitors will never see one.
 *
 * Five acts, each a different behaviour of a humpback:
 *   breach   leaps clear, turns, falls back on its side
 *   blow     surfaces twice to breathe, the spout drifting off in the air
 *   fluke    arches its back, lifts its tail clear of the water, sounds
 *   spyhop   raises its head straight up, holds — as if looking back — sinks
 *   pod      a mother and calf rolling along the surface, travelling
 */

export const WHALE_ACTS = ['breach', 'blow', 'fluke', 'spyhop', 'pod'] as const
export type WhaleAct = (typeof WHALE_ACTS)[number]
export type WhaleCue = 'splash' | 'blow'

const DURATION: Record<WhaleAct, number> = { breach: 8.5, blow: 11, fluke: 9.5, spyhop: 9, pod: 13 }
/** Seconds of unbroken stay before a sighting; drawn again after each one. */
export const WHALE_WAIT = [90, 150] as const

const DEG = Math.PI / 180
const N = 26
const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** A body, in the sighting's local frame: facing +x, y down, 0 = the sea surface, lengths in px. */
interface BodyPose {
  hx: number
  hy: number
  /** Direction the head points. */
  heading: number
  /** Total turn of the spine from head to tail (radians); positive arches the back. */
  bend: number
  L: number
  fin: number
  fluke: number
  /** Angle of the pectoral fins from the body (default: swept back). */
  finAngle?: number
  /** Show the far-side flipper too (a head-on spyhop). */
  fins2?: boolean
  /** Where along the body the flippers join (default 0.3). */
  finAt?: number
}

/** Just the tail stock and flukes, rising from base B along `angle`. */
interface TailPose {
  bx: number
  by: number
  angle: number
  len: number
  L: number
  fluke: number
}

type Pose = ({ kind: 'body' } & BodyPose) | ({ kind: 'tail' } & TailPose)

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  r: number
  kind: 'drop' | 'mist' | 'foam'
}

interface Show {
  act: WhaleAct
  t: number
  dur: number
  /** Screen position of the sighting: centre of the horizon. */
  cx: number
  hy: number
  dir: 1 | -1
  L: number
  half: number
  fade: number
  leaving: boolean
  /** Reduced motion: one held silhouette, fading in and out. */
  still: boolean
  particles: Particle[]
  fired: Set<string>
  spouts: { from: number; until: number; x: number; y: number; scale: number }[]
}

export interface WhaleScene {
  W: number
  H: number
  mobile: boolean
  c1x: number
  c1y: number
  r1max: number
}

export interface WhaleText {
  intro: DOMRect | null
  head: DOMRect | null
}

export interface WhaleStatus {
  dwell: number
  nextAt: number
  playing: WhaleAct | null
  t: number
  queued: number
}

export class WhaleWatch {
  /** Seconds of unbroken eligible stay so far. */
  dwell = 0
  nextAt = rand(...WHALE_WAIT)
  show: Show | null = null
  onCue: ((cue: WhaleCue, x01: number, size: number) => void) | null = null

  private bag: WhaleAct[] = []
  private last: WhaleAct | null = null
  private queue: WhaleAct[] = []
  private scene: WhaleScene | null = null
  private text: () => WhaleText = () => ({ intro: null, head: null })
  private avoid: () => { x: number; y: number } | null = () => null
  // spine scratch
  private sx = new Float32Array(N + 1)
  private sy = new Float32Array(N + 1)
  private dx = new Float32Array(N + 1)
  private dy = new Float32Array(N + 1)
  private ax = new Float32Array(N + 1)
  private ay = new Float32Array(N + 1)

  constructor(private reduced: boolean) {}

  setScene(scene: WhaleScene) {
    this.scene = scene
  }

  setText(fn: () => WhaleText) {
    this.text = fn
  }

  /** A point to keep clear of (the tide hand's label, which follows the Moon). */
  setAvoid(fn: () => { x: number; y: number } | null) {
    this.avoid = fn
  }

  /** Development: queue an act (or all five) to play the next time chapter 01 is at rest. */
  request(what: WhaleAct | 'all' | 'random') {
    if (what === 'all') this.queue.push(...WHALE_ACTS)
    else this.queue.push(what === 'random' ? this.pick() : what)
  }

  status(): WhaleStatus {
    return {
      dwell: this.dwell,
      nextAt: this.nextAt,
      playing: this.show?.act ?? null,
      t: this.show?.t ?? 0,
      queued: this.queue.length,
    }
  }

  /** Never the same act twice in a row; all five before any repeats. */
  private pick(): WhaleAct {
    if (!this.bag.length) {
      const bag = [...WHALE_ACTS].sort(() => Math.random() - 0.5)
      if (bag[0] === this.last) bag.push(bag.shift()!)
      this.bag = bag
    }
    const act = this.bag.shift()!
    this.last = act
    return act
  }

  /**
   * @param eligible chapter 01 at rest, visitor inside, page visible.
   * Leaving (or hiding the page) cancels the timer; returning starts it over.
   */
  update(dt: number, eligible: boolean) {
    const s = this.show
    if (s) {
      s.t += dt
      if (!eligible && !s.leaving) s.leaving = true
      if (s.leaving) s.fade -= dt * 2.6
      this.advanceShow(s, dt)
      if (s.t >= s.dur || s.fade <= 0) {
        this.show = null
        this.dwell = 0
        this.nextAt = rand(...WHALE_WAIT)
      }
      return
    }
    if (!eligible) {
      this.dwell = 0
      return
    }
    if (this.queue.length) {
      this.start(this.queue.shift()!)
      return
    }
    this.dwell += dt
    if (this.dwell >= this.nextAt) this.start(this.pick())
  }

  // ───────────────────────────────────────────────────── staging

  private start(act: WhaleAct) {
    const r = this.scene && this.region(this.scene, this.text())
    if (!r) {
      // no open water in this layout: try again after another wait
      this.dwell = 0
      this.nextAt = rand(...WHALE_WAIT)
      return
    }
    // keep clear of the tide hand's label, wherever the Moon has put it
    const avoid = this.avoid()
    let cx = rand(r.x0, r.x1)
    if (avoid && Math.abs(avoid.y - r.y) < r.L * 1.4) {
      const clear = (x: number) => Math.abs(x - avoid.x) > r.half + 50
      const options = [r.x0, r.x1, rand(r.x0, r.x1), ...(r.alt ?? [])].filter(clear)
      if (!options.length) {
        this.dwell = 0
        this.nextAt = rand(...WHALE_WAIT)
        return
      }
      cx = options[Math.floor(Math.random() * options.length)]
    } else if (r.alt && Math.random() < 0.5) cx = r.alt[0]
    const still = this.reduced
    this.show = {
      act: still ? 'fluke' : act,
      t: 0,
      dur: still ? 7 : DURATION[act],
      cx,
      hy: r.y,
      dir: Math.random() < 0.5 ? 1 : -1,
      L: r.L,
      half: r.half,
      fade: 1,
      leaving: false,
      still,
      particles: [],
      fired: new Set(),
      spouts: [],
    }
  }

  /** Where open sea can be shown without touching text or the tide clock. */
  private region(sc: WhaleScene, text: WhaleText) {
    const { W, H } = sc
    if (sc.mobile) {
      // out at the screen's edges, below the tide clock's bezel and above the chapter label
      const L = clamp(W * 0.1, 32, 44)
      const y = sc.c1y + sc.r1max + 36
      const labelTop = text.head?.top ?? H * 0.65
      if (y + 12 > labelTop - 4) return null
      return { x0: W * 0.13, x1: W * 0.13, alt: [W * 0.87], y, L, half: W * 0.11 }
    }
    // in the fog between the opening paragraph and the title block, left of the bezel
    const top = text.intro?.bottom ?? H * 0.28
    const bottom = text.head?.top ?? H * 0.48
    let L = clamp(W * 0.046, 46, 78)
    const room = bottom - top
    if (room < L * 0.95 + 40) L = (room - 40) / 0.95
    if (L < 30) return null
    const y = top + L * 0.95 + 14 + Math.max(0, room - L * 0.95 - 40) * 0.35
    const dy = y - sc.c1y
    const bezel = sc.r1max + 60
    const ringLeft = sc.c1x - Math.sqrt(Math.max(0, bezel * bezel - dy * dy))
    const xMin = Math.max(24, W * 0.044)
    const xMax = Math.min(ringLeft - 30, W * 0.42)
    const half = Math.min(L * 2.6, (xMax - xMin) / 2)
    if (half < L * 1.4) return null
    return { x0: xMin + half, x1: xMax - half, alt: undefined as number[] | undefined, y, L, half }
  }

  // ───────────────────────────────────────────────── choreography

  /** The poses of the current moment, in local coordinates. */
  private poses(s: Show): Pose[] {
    const t = s.still ? 4.7 : s.t
    const L = s.L
    const out: Pose[] = []
    const add = (p: BodyPose | null) => p && out.push({ kind: 'body', ...p })

    switch (s.act) {
      case 'breach': {
        // the centre of mass on a slow ballistic arc; the body turns over backwards
        const T = (t - 0.8) / 1.35
        const y = 0.42 - 1.58 * T + 0.75 * T * T
        if (T > 0 && y < 0.95) {
          const heading = lerp(-80, -165, easeInOutSine(clamp(T / 1.8))) * DEG
          const comX = (-0.1 + 0.14 * T) * L
          out.push({
            kind: 'body',
            hx: comX + Math.cos(heading) * 0.36 * L,
            hy: y * L + Math.sin(heading) * 0.36 * L,
            heading,
            bend: lerp(-0.35, 0.25, clamp(T / 1.8)),
            L,
            fin: smoothstep(0.25, 0.6, T) * (1 - smoothstep(1.5, 1.85, T)),
            fluke: 0.3,
          })
        }
        break
      }
      case 'blow':
        add(roll(t, 0.8, 4.2, L, 0.085 * L, 1.15 * L, -0.55 * L, 0.06 * L))
        add(roll(t, 6.1, 3.9, L, 0.075 * L, 1.15 * L, -0.2 * L, 0.06 * L))
        break
      case 'fluke': {
        add(roll(t, 0.6, 3.0, L, 0.13 * L, 0.95 * L, -0.62 * L, 0.08 * L))
        if (t > 3.3 && t < 6.9) {
          const up = easeOutCubic(clamp((t - 3.3) / 1.2))
          const sink = clamp((t - 5.0) / 1.6)
          out.push({
            kind: 'tail',
            // the tail rises where the body went under
            bx: (0.1 + 0.03 * (t - 3.3)) * L,
            by: (lerp(0.3, 0.06, up) + 0.62 * sink * sink) * L,
            angle: lerp(-160, -97, up) * DEG,
            len: 0.48 * L,
            L,
            fluke: smoothstep(3.5, 4.4, t),
          })
        }
        break
      }
      case 'spyhop': {
        let hy: number
        if (t < 2.9) hy = lerp(0.12, -0.44, easeOutCubic(clamp((t - 0.8) / 2.1)))
        else if (t < 5.8) hy = -0.44 + 0.012 * Math.sin(t * 1.7)
        else hy = lerp(-0.44, 0.22, easeInOutSine(clamp((t - 5.8) / 1.8)))
        out.push({
          kind: 'body',
          hx: 0.05 * L * Math.sin(t * 0.3),
          hy: hy * L,
          heading: (-82 + 3 * Math.sin(t * 0.7)) * DEG,
          bend: 0.06,
          L,
          // the long flippers rest out on the surface either side, as it hangs upright
          fin: 0.7 * smoothstep(1.4, 2.6, t) * (1 - smoothstep(5.8, 6.6, t)),
          finAngle: 62 * DEG,
          finAt: 0.33,
          fins2: true,
          fluke: 0,
        })
        break
      }
      case 'pod': {
        const v = 0.1 * L
        const calf = 0.55 * L
        for (const t0 of [0.7, 4.7, 8.7]) add(roll(t, t0, 3.4, L, 0.07 * L, 1.3 * L, -0.9 * L + v * t0, v))
        for (const t0 of [1.3, 3.5, 5.7, 7.9, 10.1])
          add(roll(t, t0, 1.9, calf, 0.06 * calf, 1.2 * calf, -0.28 * L + v * t0, v))
        break
      }
    }
    return out
  }

  /** Splashes, spouts, drips and foam — each moment fires once. */
  private advanceShow(s: Show, dt: number) {
    const L = s.L
    const t = s.t
    const X = (x: number) => s.cx + s.dir * x
    const once = (key: string, when: boolean, fn: () => void) => {
      if (when && !s.fired.has(key) && !s.still && !s.leaving) {
        s.fired.add(key)
        fn()
      }
    }

    switch (s.act) {
      case 'breach': {
        const T = (t - 0.8) / 1.35
        const comX = X((-0.1 + 0.14 * T) * L)
        once('rise', T > 0.4, () => {
          this.splash(s, comX, 14, 0.6)
          this.cue('splash', comX, 0.35)
        })
        once('land', T > 1.62, () => {
          this.splash(s, comX, 48, 1)
          this.foam(s, comX, 3)
          this.cue('splash', comX, 1)
        })
        once('slap', T > 1.9, () => this.splash(s, X((0.35 + 0.14 * T) * L), 16, 0.55))
        break
      }
      case 'blow':
        for (const [k, t0, x0] of [['a', 0.8, -0.55], ['b', 6.1, -0.2]] as const) {
          once(`blow-${k}`, t > t0 + 0.85, () => {
            const p = this.blowhole(s)
            if (p) this.spout(s, p.x, p.y, 1)
          })
          once(`foam-${k}`, t > t0 + 0.4, () => this.foam(s, X((x0 + 0.06 * (t - t0) + 0.3) * L), 1))
        }
        break
      case 'fluke':
        once('foam', t > 1.0, () => this.foam(s, X(-0.3 * L), 1))
        once('slip', t > 6.35, () => {
          const x = X((0.1 + 0.03 * 3) * L)
          this.splash(s, x, 10, 0.35)
          this.foam(s, x, 2)
          this.cue('splash', x, 0.25)
        })
        // water running off the trailing edge while the flukes are in the air
        if (!s.still && !s.leaving && t > 4.0 && t < 6.3) this.drip(s, dt)
        break
      case 'spyhop':
        once('up', t > 1.0, () => {
          this.foam(s, s.cx, 2)
          this.splash(s, s.cx, 6, 0.3)
        })
        once('down', t > 7.3, () => this.foam(s, s.cx, 2))
        break
      case 'pod':
        once('blow', t > 1.55, () => {
          const p = this.blowhole(s)
          if (p) this.spout(s, p.x, p.y, 0.65)
        })
        for (const t0 of [0.7, 4.7, 8.7]) once(`f${t0}`, t > t0 + 0.5, () => this.foam(s, X((-0.9 + 0.1 * t0 + 0.45) * L), 1))
        break
    }

    // the spout keeps breathing out for a moment
    for (const sp of s.spouts) {
      if (t < sp.from || t > sp.until) continue
      // a narrow jet first, then the bushy bloom of a humpback's breath
      const jet = t - sp.from < 0.14
      const n = Math.round(dt * 170 * sp.scale)
      for (let i = 0; i < n; i++) {
        s.particles.push({
          x: sp.x + rand(-1.2, 1.2),
          y: sp.y,
          vx: (jet ? rand(-0.05, 0.05) : rand(-0.28, 0.28)) * L * sp.scale + 0.03 * L * s.dir,
          vy: -(jet ? rand(0.95, 1.15) : rand(0.45, 0.8)) * L * sp.scale,
          age: 0,
          life: rand(1.3, 2.1),
          r: rand(0.7, 1.3),
          kind: 'mist',
        })
      }
    }

    // particles
    const g = 2.2 * L
    for (const p of s.particles) {
      p.age += dt
      if (p.kind === 'drop') {
        p.vy += g * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.y > s.hy + 1) p.age = p.life
      } else if (p.kind === 'mist') {
        const drag = Math.exp(-3.2 * dt)
        p.vx = p.vx * drag + 0.04 * L * s.dir * dt
        p.vy = p.vy * drag - 0.02 * L * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.r += dt * 2.2
      }
    }
    s.particles = s.particles.filter((p) => p.age < p.life)
  }

  private splash(s: Show, x: number, n: number, size: number) {
    const L = s.L
    for (let i = 0; i < n; i++) {
      s.particles.push({
        x: x + rand(-0.32, 0.32) * L * size,
        y: s.hy - 0.5,
        vx: rand(-0.75, 0.75) * L * size,
        vy: -rand(0.55, 1.6) * L * Math.sqrt(size),
        age: 0,
        life: 2,
        r: rand(0.5, 1.1),
        kind: 'drop',
      })
    }
    for (let i = 0; i < n / 3; i++) {
      s.particles.push({
        x: x + rand(-0.3, 0.3) * L * size,
        y: s.hy - rand(0, 0.2) * L * size,
        vx: rand(-0.12, 0.12) * L,
        vy: -rand(0.1, 0.35) * L,
        age: 0,
        life: rand(1.4, 2.4),
        r: rand(0.8, 1.6),
        kind: 'mist',
      })
    }
  }

  private foam(s: Show, x: number, n: number) {
    for (let i = 0; i < n; i++) {
      s.particles.push({ x, y: s.hy + 1.5 + i * 2.6, vx: 0, vy: 0, age: -i * 0.25, life: 2.6, r: 0, kind: 'foam' })
    }
  }

  private spout(s: Show, x: number, y: number, scale: number) {
    s.spouts.push({ from: s.t, until: s.t + 0.45, x, y, scale })
    this.cue('blow', x, scale)
  }

  private drip(s: Show, dt: number) {
    const pose = this.poses(s).find((p) => p.kind === 'tail') as (TailPose & { kind: 'tail' }) | undefined
    if (!pose) return
    const n = Math.random() < dt * 42 ? 1 : 0
    for (let i = 0; i < n; i++) {
      // anywhere along the trailing edge of the flukes
      const tip = this.flukeTips(pose)
      const k = Math.random()
      const lx = lerp(tip.ax, tip.bx, k)
      const ly = lerp(tip.ay, tip.by, k) + Math.abs(k - 0.5) * -0.04 * s.L
      s.particles.push({
        x: s.cx + s.dir * lx,
        y: s.hy + ly,
        vx: 0,
        vy: rand(0, 0.15) * s.L,
        age: 0,
        life: 1.4,
        r: rand(0.5, 1),
        kind: 'drop',
      })
    }
  }

  /** Screen position of the (first visible) blowhole, if above water. */
  private blowhole(s: Show) {
    const body = this.poses(s).find((p) => p.kind === 'body') as (BodyPose & { kind: 'body' }) | undefined
    if (!body) return null
    this.spine(body)
    const i = Math.round(0.13 * N)
    const x = this.sx[i] + this.dx[i] * body.L * 0.07
    const y = this.sy[i] + this.dy[i] * body.L * 0.07
    return y < 2 ? { x: s.cx + s.dir * x, y: s.hy + Math.min(y, 0) } : null
  }

  private cue(cue: WhaleCue, x: number, size: number) {
    if (this.scene) this.onCue?.(cue, x / this.scene.W, size)
  }

  // ─────────────────────────────────────────────────────── drawing

  /** Drawn beneath the contours in the surface pass. */
  draw(ctx: CanvasRenderingContext2D, pal: Palette, bg: RGB) {
    const s = this.show
    if (!s) return
    const env =
      clamp(s.fade) * smoothstep(0, 1.1, s.t) * (1 - smoothstep(s.dur - 1.5, s.dur, s.t))
    if (env < 0.003) return
    // distance: the ink is hazed toward the fog
    const ink = mix(pal.surfaceInk, bg, 0.36)
    this.drawHorizon(ctx, s, ink, env)

    ctx.save()
    ctx.beginPath()
    ctx.rect(s.cx - s.half - s.L * 2, 0, (s.half + s.L * 2) * 2, s.hy + 0.25)
    ctx.clip()
    const path = new Path2D()
    for (const p of this.poses(s)) {
      if (p.kind === 'body') this.bodyPath(path, p, s)
      else this.tailPath(path, p, s)
    }
    ctx.fillStyle = rgba(ink, 0.6 * env)
    ctx.fill(path)
    ctx.lineJoin = 'round'
    ctx.lineWidth = 0.8
    ctx.strokeStyle = rgba(ink, 0.55 * env)
    ctx.stroke(path)
    ctx.restore()

    for (const p of s.particles) {
      if (p.age < 0) continue
      const k = p.age / p.life
      if (p.kind === 'foam') {
        const len = (0.25 + 0.75 * easeOutCubic(k)) * s.L * 0.9
        ctx.beginPath()
        ctx.moveTo(p.x - len, p.y)
        ctx.lineTo(p.x + len, p.y)
        ctx.strokeStyle = rgba(ink, 0.5 * (1 - k) * env)
        ctx.lineWidth = 0.7
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        const a = p.kind === 'mist' ? 0.2 * Math.pow(1 - k, 1.6) : 0.42 * (1 - k * 0.5)
        ctx.fillStyle = rgba(ink, a * env)
        ctx.fill()
      }
    }
  }

  /** A short reach of far-off sea, tapering into the fog at both ends. */
  private drawHorizon(ctx: CanvasRenderingContext2D, s: Show, ink: RGB, env: number) {
    const rows = [
      { dy: 0, w: 1, a: 0.5 },
      { dy: 4, w: 0.72, a: 0.26 },
      { dy: 9, w: 0.46, a: 0.14 },
    ]
    for (const r of rows) {
      const half = s.half * r.w
      const x0 = s.cx - half
      const x1 = s.cx + half
      const grad = ctx.createLinearGradient(x0, 0, x1, 0)
      grad.addColorStop(0, rgba(ink, 0))
      grad.addColorStop(0.2, rgba(ink, r.a * env))
      grad.addColorStop(0.8, rgba(ink, r.a * env))
      grad.addColorStop(1, rgba(ink, 0))
      ctx.beginPath()
      for (let x = x0; x <= x1; x += 6) {
        const y = s.hy + r.dy + Math.sin(x * 0.07 + s.t * 1.3 + r.dy) * 0.45 * (r.dy ? 1 : 0.4)
        if (x === x0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = grad
      ctx.lineWidth = r.dy ? 0.6 : 0.8
      ctx.stroke()
    }
  }

  /** Integrate the spine (head → tail) and the dorsal normals into scratch. */
  private spine(p: BodyPose) {
    let x = p.hx
    let y = p.hy
    for (let i = 0; i <= N; i++) {
      const s = i / N
      const a = p.heading + Math.PI - p.bend * s
      const tx = Math.cos(a)
      const ty = Math.sin(a)
      this.sx[i] = x
      this.sy[i] = y
      this.dx[i] = -ty
      this.dy[i] = tx
      this.ax[i] = tx
      this.ay[i] = ty
      x += (tx * p.L) / N
      y += (ty * p.L) / N
    }
  }

  private bodyPath(path: Path2D, p: BodyPose, s: Show) {
    this.spine(p)
    const { sx, sy, dx, dy, ax, ay } = this
    const L = p.L
    const X = (x: number) => s.cx + s.dir * x
    const Y = (y: number) => s.hy + y
    const back = (k: number) =>
      L *
      (0.082 * profile(k) +
        0.02 * Math.exp(-(((k - 0.64) / 0.08) ** 2)) +
        0.03 * Math.exp(-(((k - 0.675) / 0.022) ** 2)))
    const belly = (k: number) => L * 0.098 * profile(k) * (k < 0.42 ? 1.08 : 1)

    // snout, then the back to the tail stock
    path.moveTo(X(sx[0] - ax[0] * 0.02 * L), Y(sy[0] - ay[0] * 0.02 * L))
    for (let i = 1; i <= N; i++) {
      const b = back(i / N)
      path.lineTo(X(sx[i] + dx[i] * b), Y(sy[i] + dy[i] * b))
    }
    this.flukes(path, s, sx[N], sy[N], ax[N], ay[N], dx[N], dy[N], L, p.fluke, back(1), belly(1))
    for (let i = N; i >= 1; i--) {
      const b = belly(i / N)
      path.lineTo(X(sx[i] - dx[i] * b), Y(sy[i] - dy[i] * b))
    }
    path.closePath()

    // the long pectoral fin, swept back and down
    if (p.fin > 0.02) {
      const at = p.finAt ?? 0.3
      const i = Math.round(at * N)
      const beta = p.finAngle ?? 38 * DEG
      for (const side of p.fins2 ? [1, -1] : [1]) {
        // the near flipper hangs from the belly; the far one shows past the back, a little shorter
        const off = side > 0 ? -belly(at) * 0.7 : back(at) * 0.6
        const vx = sx[i] + dx[i] * off
        const vy = sy[i] + dy[i] * off
        let fx = ax[i] * Math.cos(beta) - side * dx[i] * Math.sin(beta)
        let fy = ay[i] * Math.cos(beta) - side * dy[i] * Math.sin(beta)
        const fl = Math.hypot(fx, fy) || 1
        fx /= fl
        fy /= fl
        const len = 0.31 * L * p.fin * (side > 0 ? 1 : 0.82)
        const w = 0.028 * L
        const nx = -fy
        const ny = fx
        path.moveTo(X(vx + nx * w), Y(vy + ny * w))
        path.quadraticCurveTo(X(vx + fx * len * 0.6 + nx * w), Y(vy + fy * len * 0.6 + ny * w), X(vx + fx * len), Y(vy + fy * len))
        path.quadraticCurveTo(X(vx + fx * len * 0.5 - nx * w * 0.6), Y(vy + fy * len * 0.5 - ny * w * 0.6), X(vx - nx * w), Y(vy - ny * w))
        path.closePath()
      }
    }
  }

  private tailPath(path: Path2D, p: TailPose, s: Show) {
    const X = (x: number) => s.cx + s.dir * x
    const Y = (y: number) => s.hy + y
    const tx = Math.cos(p.angle)
    const ty = Math.sin(p.angle)
    const nx = -ty
    const ny = tx
    const w0 = 0.062 * p.L
    const w1 = 0.024 * p.L
    const topX = p.bx + tx * p.len
    const topY = p.by + ty * p.len
    path.moveTo(X(p.bx + nx * w0), Y(p.by + ny * w0))
    path.quadraticCurveTo(X(p.bx + tx * p.len * 0.6 + nx * w1 * 1.3), Y(p.by + ty * p.len * 0.6 + ny * w1 * 1.3), X(topX + nx * w1), Y(topY + ny * w1))
    this.flukes(path, s, topX, topY, tx, ty, nx, ny, p.L, p.fluke, w1, w1)
    path.quadraticCurveTo(X(p.bx + tx * p.len * 0.6 - nx * w1 * 1.3), Y(p.by + ty * p.len * 0.6 - ny * w1 * 1.3), X(p.bx - nx * w0), Y(p.by - ny * w0))
    path.closePath()
  }

  /**
   * The flukes at a tail point P, extending along t, spread along d. `f` turns
   * them from edge-on (a thin blade) to facing the viewer (the full fan).
   */
  private flukes(
    path: Path2D,
    s: Show,
    px: number,
    py: number,
    tx: number,
    ty: number,
    dx: number,
    dy: number,
    L: number,
    f: number,
    wBack: number,
    wBelly: number,
  ) {
    const X = (x: number) => s.cx + s.dir * x
    const Y = (y: number) => s.hy + y
    const span = 0.2 * L * f + 0.014 * L
    const ext = 0.07 * L + 0.05 * L * (1 - f)
    const ax = px + tx * ext + dx * span
    const ay = py + ty * ext + dy * span
    const bx = px + tx * ext - dx * span
    const by = py + ty * ext - dy * span
    const nx = px + tx * (0.03 * L + 0.06 * L * (1 - f))
    const ny = py + ty * (0.03 * L + 0.06 * L * (1 - f))
    path.lineTo(X(px + dx * wBack), Y(py + dy * wBack))
    path.quadraticCurveTo(X(px + dx * span * 0.55), Y(py + dy * span * 0.55), X(ax), Y(ay))
    path.quadraticCurveTo(X((ax + nx) / 2 + tx * 0.025 * L), Y((ay + ny) / 2 + ty * 0.025 * L), X(nx), Y(ny))
    path.quadraticCurveTo(X((bx + nx) / 2 + tx * 0.025 * L), Y((by + ny) / 2 + ty * 0.025 * L), X(bx), Y(by))
    path.quadraticCurveTo(X(px - dx * span * 0.55), Y(py - dy * span * 0.55), X(px - dx * wBelly), Y(py - dy * wBelly))
  }

  /** Trailing-edge endpoints of the flukes of a tail pose, local coordinates. */
  private flukeTips(p: TailPose) {
    const tx = Math.cos(p.angle)
    const ty = Math.sin(p.angle)
    const nx = -ty
    const ny = tx
    const px = p.bx + tx * p.len
    const py = p.by + ty * p.len
    const span = 0.2 * p.L * p.fluke + 0.014 * p.L
    const ext = 0.07 * p.L + 0.05 * p.L * (1 - p.fluke)
    return {
      ax: px + tx * ext + nx * span,
      ay: py + ty * ext + ny * span,
      bx: px + tx * ext - nx * span,
      by: py + ty * ext - ny * span,
    }
  }
}

/** Side-view depth of a humpback along its length: a full head, tapering to the tail stock. */
function profile(s: number) {
  return s < 0.3
    ? 0.3 + 0.7 * Math.sin((Math.PI / 2) * (s / 0.3))
    : Math.pow(1 - smoothstep(0.3, 0.98, s), 1.15) * 0.86 + 0.14
}

/**
 * A surfacing roll: the head travels clockwise round a circle whose top
 * breaks the water by `peak`, the body following on the same circle, so the
 * back rolls through the surface and goes under again.
 */
function roll(t: number, t0: number, dur: number, L: number, peak: number, R: number, x0: number, speed: number): BodyPose | null {
  const u = (t - t0) / dur
  if (u <= 0 || u >= 1) return null
  const k = L / R
  const psi = lerp(-Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62 + k, u)
  const xc = x0 + speed * (t - t0)
  const yc = R - peak
  return { hx: xc + R * Math.cos(psi), hy: yc + R * Math.sin(psi), heading: psi + Math.PI / 2, bend: k, L, fin: 0, fluke: 0.08 }
}
