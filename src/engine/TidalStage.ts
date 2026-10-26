import { story } from './story'
import { pointer } from './pointer'
import { createNoise3D } from './noise'
import {
  TAU,
  clamp,
  damp,
  easeInOutCubic,
  easeInOutSine,
  lerp,
  smoothstep,
  stagger,
} from './math'
import { type Palette, type RGB, mix, rgba } from './palette'
import type { Knockout } from './knockout'
import { RECORDS, readHeadU, recordId, recordLine } from './records'
import { listen } from './listen'
import { m2Phase, nextHighWater } from './tideClock'
import { WhaleWatch } from './Whale'

/**
 * THE AMPHIDROME
 * An amphidromic point is where the tide stands still while the tidal wave
 * rotates around it. Its co-range contours are the motif of the whole site:
 *
 *   Ch1  closed contours around a still point, a tide hand turning
 *   →    contours unbend (constant arc length, falling curvature) into strata
 *   Ch2  strata stretch into full-width tide records, read by a moving head
 *   →    records condense and curl back around a new centre
 *   Ch3  the full vortex: pulses, crests and echoes, then contracts to an emblem
 *
 * Every state is computed from the same N lines, so the transitions are
 * literal transformations of one drawing, never cross-fades.
 */

interface Line {
  k: number
  n: number
  xs: Float32Array
  ys: Float32Array
  path: Path2D | null
  index: boolean
  highlight: boolean
  /** The visitor's echo: the newest, outermost stratum. */
  echo: boolean
  hash: number
  r1: number
  c1x: number
  c1y: number
  r3: number
  r4: number
}

interface Ripple {
  x: number
  y: number
  age: number
  life: number
  amp: number
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

type PassKind = 'surface' | 'deep'

const MONO = '"Fragment Mono", ui-monospace, monospace'

export class TidalStage {
  private ctx: CanvasRenderingContext2D
  private noise = createNoise3D(11)
  private lines: Line[] = []
  private ripples: Ripple[] = []
  private rippleCooldown = 0

  private W = 1
  private H = 1
  private dpr = 1
  private mobile = false

  // chapter 01 amphidrome
  private c1x = 0
  private c1y = 0
  private r1max = 0
  // chapter 02 band
  private b0 = 0
  private b1 = 0
  private island: Rect | null = null
  /** Narrow screens: the band between the header and the chapter-01 title the tide clock must fit. */
  private heroBox: { top: number; bottom: number } | null = null
  // chapter 03 vortex → emblem
  private c3x = 0
  private c3y = 0
  private c4x = 0
  private c4y = 0
  private r3max = 0
  private r4max = 0
  private q3 = 1

  private time = 0
  private tide = -Math.PI / 2
  private trueTide = -Math.PI / 2
  private sinceTide = 99
  private highWater = ''
  private spin = 0
  private tapsSeen = 0
  private echo: { wave: number[]; reveal: number; date: string } | null = null
  /** 0..1 — the whale has been answered; set by the engine. */
  answer = 0
  /** The hidden sighting of chapter 01. */
  readonly whale: WhaleWatch
  private camX = 0
  private camY = 0
  private camRot = 0

  private knockouts: Knockout[] = []
  private grain: CanvasPattern | null = null
  private vignette: CanvasGradient | null = null
  private skylight: CanvasGradient | null = null
  private waterTop: Path2D | null = null
  private waterBottom: Path2D | null = null
  private waterEdge: Path2D | null = null
  private waterEcho: Path2D[] = []

  constructor(
    private canvas: HTMLCanvasElement,
    private pal: Palette,
    private reduced: boolean,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.ctx = ctx
    this.grain = this.makeGrain()
    this.whale = new WhaleWatch(reduced)
  }

  /** A static field of film grain, composited over each pass. */
  private makeGrain() {
    const size = 180
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const img = g.createImageData(size, size)
    for (let i = 0; i < size * size; i++) {
      const v = 128 + (Math.random() + Math.random() - 1) * 127
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    g.putImageData(img, 0, 0)
    return this.ctx.createPattern(c, 'repeat')
  }

  /** Adds (or removes) the visitor's echo as an extra, outermost line. */
  setEcho(e: { wave: number[]; date: string } | null, animate = false) {
    this.echo = e ? { ...e, reveal: animate ? 0 : 1 } : null
    if (this.W > 1) this.buildLayout()
  }

  get echoLine() {
    return this.echo ? this.lines.length - 1 : -1
  }

  setHeroBox(box: { top: number; bottom: number } | null) {
    const same = box && this.heroBox && Math.abs(box.top - this.heroBox.top) < 1 && Math.abs(box.bottom - this.heroBox.bottom) < 1
    if (same) return
    this.heroBox = box
    if (this.mobile && this.W > 1) this.buildLayout()
  }

  setKnockouts(list: Knockout[]) {
    this.knockouts = list
  }

  setPalette(p: Palette) {
    this.pal = p
  }

  setIsland(rect: Rect | null) {
    this.island = rect
  }

  resize(W: number, H: number, dpr: number) {
    this.W = W
    this.H = H
    this.dpr = dpr
    this.canvas.width = Math.round(W * dpr)
    this.canvas.height = Math.round(H * dpr)
    this.canvas.style.width = `${W}px`
    this.canvas.style.height = `${H}px`
    this.buildLayout()
  }

  private buildLayout() {
    const { W, H } = this
    const mobile = W < 760
    this.mobile = mobile
    const N = (mobile ? 22 : 30) + (this.echo ? 1 : 0)
    const S = Math.min(W, H)

    this.r1max = Math.min(H * 0.41, W * 0.285)
    this.c1x = mobile ? W * 0.5 : W * 0.655
    this.c1y = H * 0.475
    if (mobile) {
      // the clock, its bezel and hour labels (≈54 px beyond the outer contour)
      // are centred in the space the header and the title leave free
      const top = this.heroBox?.top ?? H * 0.09
      const bottom = this.heroBox?.bottom ?? H * 0.64
      this.r1max = Math.max(60, Math.min(W * 0.37, H * 0.24, (bottom - top) / 2 - 54))
      this.c1y = (top + bottom) / 2
    }
    this.whale.setScene({ W, H, mobile, c1x: this.c1x, c1y: this.c1y, r1max: this.r1max })
    const r1min = this.r1max * 0.06
    const eccX = -this.r1max * 0.17
    const eccY = -this.r1max * 0.13

    this.b0 = mobile ? H * 0.1 : H * 0.115
    this.b1 = mobile ? H * 0.9 : H * 0.915

    this.c3x = W * 0.5
    this.c3y = H * 0.5
    this.r3max = Math.hypot(W, H) * (mobile ? 0.43 : 0.35)
    this.q3 = Math.min(1, (H * 0.38) / this.r3max)
    this.c4x = W * 0.5
    this.c4y = mobile ? H * 0.29 : H * 0.315
    this.r4max = mobile ? W * 0.28 : S * 0.185

    const step = mobile ? 7.5 : 6
    this.lines = []
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1)
      const kr = Math.pow(k, 1.08)
      const ecc = Math.pow(1 - k, 1.6)
      const r1 = lerp(r1min, this.r1max, kr)
      const r3 = lerp(this.r3max * 0.035, this.r3max, kr)
      const r4 = lerp(this.r4max * 0.06, this.r4max, kr)
      const maxLen = Math.max(TAU * r1, W * 1.14, TAU * r3 * 0.9)
      const n = clamp(Math.ceil(maxLen / step), 64, 620)
      this.lines.push({
        k,
        n,
        xs: new Float32Array(n),
        ys: new Float32Array(n),
        path: null,
        index: (N - 1 - i) % 5 === 0,
        highlight: i === Math.round((N - 1) * 0.57),
        echo: !!this.echo && i === N - 1,
        hash: fract(Math.sin(i * 91.7 + 3.1) * 43758.5453),
        r1,
        c1x: this.c1x + eccX * ecc,
        c1y: this.c1y + eccY * ecc,
        r3,
        r4,
      })
    }

    const ctx = this.ctx
    this.vignette = ctx.createRadialGradient(W / 2, H * 0.48, S * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.62)
    this.vignette.addColorStop(0, 'rgba(0,0,0,0)')
    this.vignette.addColorStop(1, 'rgba(0,0,0,0.42)')
    this.skylight = ctx.createLinearGradient(0, 0, 0, H)
    this.skylight.addColorStop(0, 'rgba(255,255,255,0.32)')
    this.skylight.addColorStop(0.55, 'rgba(255,255,255,0)')
    this.skylight.addColorStop(1, 'rgba(0,0,0,0.035)')
  }

  /** Height of the travelling water line at x (screen px). */
  waterY(x: number) {
    const w = story.water
    const base = lerp(this.H + 70, -90, easeInOutSine(w))
    const amp = Math.sin(Math.PI * clamp(w)) * (this.mobile ? 16 : 26)
    const t = this.time
    return base + (this.noise(x * 0.0031, 3.7, t * 0.22) * 0.8 + Math.sin(x * 0.011 + t * 1.2) * 0.2) * amp
  }

  render(dt: number) {
    this.advance(dt)
    this.computeGeometry()

    const { ctx, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const w = story.water
    if (w <= 0.0001) {
      this.drawPass('surface')
    } else if (w >= 0.9999) {
      this.drawPass('deep')
    } else {
      this.buildWater()
      ctx.save()
      ctx.clip(this.waterBottom!)
      this.drawPass('deep')
      ctx.restore()
      ctx.save()
      ctx.clip(this.waterTop!)
      this.drawPass('surface')
      ctx.restore()
      this.drawWaterEdge()
    }
  }

  // ───────────────────────────────────────────────────────────── state

  private advance(dt: number) {
    const settle = easeInOutCubic(story.settle)
    const timeScale = this.reduced ? 0.12 : lerp(1, 0.32, settle)
    this.time += dt * timeScale
    // The tide hand is a true tide clock, set by the Moon (tideClock.ts). The
    // intro sweeps it from 00 to the real phase; the chapter-03 climax spins
    // the crests ahead, and settling returns them to the truth.
    this.sinceTide += dt
    if (this.sinceTide > 1) {
      this.trueTide = -Math.PI / 2 + m2Phase()
      this.highWater = nextHighWater()
      this.sinceTide = 0
    }
    this.spin += dt * timeScale * (TAU / 70) * 2.4 * story.bloom
    const spinOut = this.spin * (1 - settle) * smoothstep(0, 0.15, story.bloom)
    const breathe = 0.05 * Math.sin(this.time * 0.35)
    this.tide = lerp(-Math.PI / 2, this.trueTide, easeInOutCubic(story.introMarks)) + spinOut + breathe
    if (this.echo && this.echo.reveal < 1) this.echo.reveal = Math.min(1, this.echo.reveal + dt / 2.6)

    const active = pointer.hasMoved && pointer.inside && pointer.idle < 2.6 && !this.mobile
    const nx = active ? (pointer.x / this.W - 0.5) * 2 : 0
    const ny = active ? (pointer.y / this.H - 0.5) * 2 : 0
    const lam = this.reduced ? 1 : 2.2
    this.camX = damp(this.camX, nx * 16, lam, dt)
    this.camY = damp(this.camY, ny * 11, lam, dt)
    this.camRot = damp(this.camRot, nx * 0.014, lam * 0.85, dt)

    // Ripples: fast passes near the drawing leave a few expanding rings; a tap drops one.
    this.rippleCooldown -= dt
    for (const tap of pointer.taps) {
      if (tap.id <= this.tapsSeen || this.reduced) continue
      this.tapsSeen = tap.id
      this.ripples.push({ x: tap.x, y: tap.y, age: 0, life: 1.9, amp: 15 })
      if (this.ripples.length > 6) this.ripples.shift()
    }
    const feeling = active || pointer.touching
    if (
      feeling &&
      !this.reduced &&
      pointer.speed > 1050 &&
      this.rippleCooldown <= 0 &&
      this.ripples.length < 6 &&
      this.nearDrawing(pointer.x, pointer.y)
    ) {
      this.ripples.push({ x: pointer.x, y: pointer.y, age: 0, life: 1.6, amp: 6 + 9 * pointer.energy })
      this.rippleCooldown = 0.2
    }
    for (const r of this.ripples) r.age += dt
    this.ripples = this.ripples.filter((r) => r.age < r.life)
  }

  private nearDrawing(x: number, y: number) {
    const band = story.spread > 0.5 && story.gather < 0.5
    if (band) return y > this.b0 - 40 && y < this.b1 + 40
    const ch3 = story.curl > 0.5
    const cx = ch3 ? lerp(this.c3x, this.c4x, story.settle) : this.c1x
    const cy = ch3 ? lerp(this.c3y, this.c4y, story.settle) : this.c1y
    const r = ch3 ? lerp(this.r3max, this.r4max, story.settle) : this.r1max
    return Math.hypot(x - cx, y - cy) < r + 70
  }

  /** Strength with which band lines bend around the chapter-02 text island. */
  private avoid(y: number, x: number) {
    const isl = this.island
    const s = story.island
    if (!isl || s <= 0.001) return y
    // a full-width island (narrow screens) deflects every record along its whole length
    const fall = this.W * 0.22
    const wide = isl.x1 > this.W * 0.8
    const wx = wide || x < isl.x1 ? 1 : 1 - smoothstep(isl.x1, isl.x1 + fall, x)
    if (wx <= 0) return y
    const mg = 22
    const top = isl.y0 - mg
    const bot = isl.y1 + mg
    const { b0, b1 } = this
    // with room above the island, the upper records pass over it; otherwise all pass below
    const split = top - b0 > this.H * 0.1 ? lerp(isl.y0, isl.y1, 0.18) : b0
    let y2: number
    if (y < split && split > b0) y2 = b0 - 6 + ((y - b0) * (top - b0 + 6)) / (split - b0)
    else y2 = bot + ((y - split) * (b1 - bot)) / Math.max(1, b1 - split)
    return lerp(y, y2, wx * easeInOutCubic(s))
  }

  // ───────────────────────────────────────────────────────── geometry

  private computeGeometry() {
    const { W, lines, noise } = this
    const st = story
    const t = this.time
    const N = lines.length
    const settle = easeInOutCubic(st.settle)
    const motion = 1 - 0.78 * settle
    const tide = this.tide

    const ch3x = lerp(this.c3x, this.c4x, settle)
    const ch3y = lerp(this.c3y, this.c4y, settle)

    const xr = lerp(W * 0.06, W * 0.94, st.read)
    const readVis =
      smoothstep(0, 0.06, st.read) * (1 - smoothstep(0.94, 1, st.read)) * (1 - st.gather)

    // focus of the camera tilt follows the drawing's centre
    const sE = easeInOutCubic(st.spread)
    const gE = easeInOutCubic(st.gather)
    const fx = lerp(lerp(this.c1x, W / 2, sE), ch3x, gE)
    const fy = lerp(lerp(this.c1y, this.H / 2, sE), ch3y, gE)

    const pOn = pointer.touching || (pointer.fine && pointer.hasMoved && pointer.inside)
    const pr = 170
    const pr2 = pr * pr
    const push = (this.reduced ? 5 : 9) + 24 * pointer.energy
    const psx = pointer.sx
    const psy = pointer.sy
    // a finger moves faster than a mouse: it drags the lines more gently
    const drag = pointer.touching ? 0.008 : 0.014
    const pvx = clamp(pointer.vx, -2400, 2400) * drag
    const pvy = clamp(pointer.vy, -2400, 2400) * drag
    const ripples = this.ripples

    // listening: a held record draws its own waveform; the still point rings with the sound
    const ls = listen.strength
    const lTarget = listen.target
    const lLine = ls > 0.001 && lTarget?.kind === 'record' ? lTarget.line : -1
    const lStill = ls > 0.001 && lTarget?.kind === 'still' ? ls * (0.3 + 1.4 * listen.level) : 0
    const lHalf = this.mobile ? 150 : 300
    const lx0 = listen.x - lHalf
    const wave = listen.wave
    const waveN = wave.length - 1

    const groups = 5
    const groupGap = this.H * 0.034 * Math.sin(Math.PI * st.disperse)
    const bandL = -0.07 * W
    const bandSpan = 1.14 * W

    for (let i = 0; i < N; i++) {
      const L = lines[i]
      const k = L.k

      const rev = this.reveal(k)
      if (rev <= 0) {
        L.path = null
        continue
      }

      const mU = easeInOutSine(stagger(st.unroll, 1 - k, 0.55))
      const mS = easeInOutCubic(stagger(st.spread, k, 0.4))
      const mG = easeInOutCubic(stagger(st.gather, 1 - k, 0.4))
      const mC = easeInOutSine(stagger(st.curl, k, 0.65))
      const m3 = 1 - mC

      const ring1W = (1 - mU) * (1 - mS) * (1 - mG)
      const ring3W = mG * mC
      const bandW = mS * (1 - mG)
      const topoAmp = lerp(3, 19, k) * Math.max(ring1W, ring3W * motion, 0.28 * (1 - bandW))
      const tideAmp = k * (13 * ring1W + ring3W * motion * (8 + 12 * st.bloom))
      const bloomAmp = ring3W * st.bloom * motion * 13

      // chapter 01 ring
      const r1 = L.r1
      const c1x = L.c1x
      const c1y = L.c1y
      const kap1 = (1 - mU) / r1
      const anchor1 = c1y + r1
      // chapter 03 ring
      const r3 = lerp(L.r3, L.r4, settle)
      const kap3 = m3 === 1 ? 0 : (1 - m3) / r3
      const anchor3 = ch3y + r3 * lerp(1, this.q3, m3)
      // chapter 02 record
      const g = Math.floor((i / N) * groups)
      const band = this.b1 - this.b0
      const byBase = this.b0 + ((k * band + g * groupGap) * band) / (band + (groups - 1) * groupGap)
      const slide = st.disperse * (0.8 + L.hash * 1.6) * 2.6 + st.read * 1.1
      const hlBoost = L.highlight ? 1.9 : 0.35 + 0.65 * L.hash
      const echoWave = L.echo && this.echo ? this.echo.wave : null
      // neighbours part around a record being listened to
      const listening = i === lLine
      let lens = 0
      if (lLine >= 0 && !listening) {
        const di = Math.abs(i - lLine)
        if (di <= 4) lens = Math.sign(i - lLine) * ls * [0, 16, 9, 5, 2][di]
      }
      const ringR = ring1W >= ring3W ? r1 : r3

      const depth = 0.35 + 0.65 * k
      const rot = this.camRot * depth
      const cr = Math.cos(rot)
      const sr = Math.sin(rot)
      const ox = this.camX * depth
      const oy = this.camY * depth

      const xs = L.xs
      const ys = L.ys
      const n = L.n
      const inv = 1 / (n - 1)

      for (let j = 0; j < n; j++) {
        const u = j * inv
        const a = (u - 0.5) * TAU

        // A — chapter 01 contour, unbending around its lowest point
        let ax: number, ay: number, anx: number, any: number
        const s1 = a * r1
        if (kap1 * r1 < 1e-3) {
          ax = c1x + s1
          ay = anchor1
          anx = 0
          any = 1
        } else {
          const aa = kap1 * s1
          const sa = Math.sin(aa)
          const ca = Math.cos(aa)
          ax = c1x + sa / kap1
          ay = anchor1 - (1 - ca) / kap1
          anx = sa
          any = ca
        }

        // B — chapter 02 record
        const bx = bandL + u * bandSpan
        const by = this.avoid(byBase, bx) + lens

        // C — chapter 03 contour, curling around its lowest point
        let cx: number, cy: number, cnx: number, cny: number
        const s3 = a * r3
        if (kap3 * r3 < 1e-3) {
          cx = ch3x + s3
          cy = anchor3
          cnx = 0
          cny = 1
        } else {
          const aa = kap3 * s3
          const sa = Math.sin(aa)
          const ca = Math.cos(aa)
          cx = ch3x + sa / kap3
          cy = anchor3 - (1 - ca) / kap3
          cnx = sa
          cny = ca
        }

        // blend A → B → C
        let x = ax + (bx - ax) * mS
        let y = ay + (by - ay) * mS
        let nx = anx * (1 - mS)
        let ny = any * (1 - mS) + mS
        x += (cx - x) * mG
        y += (cy - y) * mG
        nx += (cnx - nx) * mG
        ny += (cny - ny) * mG
        const nl = Math.hypot(nx, ny) || 1
        nx /= nl
        ny /= nl

        // displacement along the normal
        let d = 0
        if (topoAmp > 0.05) {
          d += noise(x * 0.0024 + 7.3, y * 0.0024 - 2.1, t * 0.05) * topoAmp
        }
        if (tideAmp > 0.01) {
          // screen angle of this point around its centre
          const ang = Math.PI / 2 - a
          d += Math.cos(ang - tide) * tideAmp
          if (ring3W > 0) d += Math.cos(2 * (ang - tide)) * ring3W * st.bloom * motion * 6
        }
        if (bandW > 0.001) {
          let b =
            noise(bx * 0.0043 + slide, i * 0.71, t * 0.085) * 9 +
            noise(bx * 0.012 - slide * 1.7, i * 1.37 + 50, t * 0.16) * 3
          const rd = (bx - xr) / 62
          if (readVis > 0 && rd > -3 && rd < 3) {
            b += readVis * 15 * Math.exp(-rd * rd) * Math.sin(bx * 0.14 - t * 6 + i * 0.9) * hlBoost
          }
          if (listening) {
            const tt = (bx - lx0) / (2 * lHalf)
            if (tt > 0 && tt < 1) {
              const hann = Math.sin(Math.PI * tt) ** 2
              b += wave[(tt * waveN) | 0] * 30 * hann * ls
            }
          }
          d += b * bandW
        }
        if (echoWave) {
          const f = u * 63
          const e0 = echoWave[f | 0]
          const e1 = echoWave[Math.min(63, (f | 0) + 1)]
          d += (e0 + (e1 - e0) * (f - (f | 0))) * (this.mobile ? 7 : 11)
        }
        if (lStill > 0) {
          const ringness = ring1W + ring3W
          // pressure bands travelling outward, as a sound wave would compress the water
          if (ringness > 0.01) d += lStill * 10 * Math.sin((TAU * ringR) / 90 - t * 7) * ringness
        }
        if (bloomAmp > 0.01) {
          const ang = Math.PI / 2 - a
          d += bloomAmp * Math.sin((TAU * r3) / 150 - t * 1.9) * (0.65 + 0.35 * Math.cos(2 * (ang - tide)))
        }

        let px = x + nx * d
        let py = y + ny * d

        // camera: low-amplitude tilt and parallax, deeper lines move more
        const rx = px - fx
        const ry = py - fy
        px = fx + rx * cr - ry * sr + ox
        py = fy + rx * sr + ry * cr + oy

        // pointer field: the drawing parts around the cursor and is dragged by it
        if (pOn) {
          const dx = px - psx
          const dy = py - psy
          const dd = dx * dx + dy * dy
          if (dd < pr2) {
            const dist = Math.sqrt(dd) + 0.001
            const q = 1 - dist / pr
            const f = q * q * (3 - 2 * q)
            px += (dx / dist) * f * push + pvx * f
            py += (dy / dist) * f * push + pvy * f
          }
        }
        for (let r = 0; r < ripples.length; r++) {
          const rp = ripples[r]
          const dx = px - rp.x
          const dy = py - rp.y
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.001
          const front = rp.age * 320
          const band = (dist - front) / 34
          if (band > -3 && band < 3) {
            const fade = 1 - rp.age / rp.life
            const f = Math.exp(-band * band) * rp.amp * fade * fade
            px += (dx / dist) * f
            py += (dy / dist) * f
          }
        }

        xs[j] = px
        ys[j] = py
      }

      // path, with the intro reveal growing symmetrically from the lowest point
      const path = new Path2D()
      let j0 = 0
      let j1 = n - 1
      const shown = L.echo && this.echo ? Math.min(rev, easeInOutCubic(this.echo.reveal)) : rev
      if (shown < 1) {
        const half = ((n - 1) * shown) / 2
        j0 = Math.max(0, Math.round((n - 1) / 2 - half))
        j1 = Math.min(n - 1, Math.round((n - 1) / 2 + half))
      }
      path.moveTo(xs[j0], ys[j0])
      for (let j = j0 + 1; j <= j1; j++) path.lineTo(xs[j], ys[j])
      L.path = path
    }
  }

  /** Where chapter 01's tide-hand label sits — the whale keeps its distance. */
  get handLabel() {
    const inner = this.lines[0]
    if (!inner) return null
    const R = this.r1max + (this.mobile ? 30 : 44) + 26
    return { x: inner.c1x + Math.cos(this.tide) * R, y: inner.c1y + Math.sin(this.tide) * R }
  }

  get tideAngle() {
    return this.tide
  }

  get lineCount() {
    return this.lines.length
  }

  /** The line that answers the 52 Hz whale in chapter 03. */
  get answerLine() {
    return Math.round((this.lines.length - 1) * 0.79)
  }

  get highlightLine() {
    return this.lines.findIndex((L) => L.highlight)
  }

  /** The record nearest a screen point, while the records are laid out (chapter 02). */
  pickRecord(x: number, y: number) {
    if (story.spread < 0.8 || story.gather > 0.3) return -1
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.lines.length; i++) {
      const yy = this.lineYAt(i, x)
      if (yy === null) continue
      const d = Math.abs(yy - y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  lineYAt(i: number, x: number) {
    const L = this.lines[i]
    if (!L?.path) return null
    const u = clamp((x + 0.07 * this.W) / (1.14 * this.W))
    return L.ys[Math.round(u * (L.n - 1))]
  }

  private reveal(k: number) {
    return easeInOutCubic(stagger(story.intro, k, 0.75))
  }

  // ───────────────────────────────────────────────────────── drawing

  private drawPass(kind: PassKind) {
    const { ctx, W, H, pal, lines } = this
    const st = story
    const surface = kind === 'surface'
    const bg: RGB = surface ? pal.surfaceBg : mix(pal.deepBg, pal.deepBgWarm, st.warm)
    const ink: RGB = surface ? pal.surfaceInk : pal.deepInk
    const soft: RGB = surface ? pal.surfaceSoft : pal.deepSoft

    ctx.fillStyle = rgba(bg)
    ctx.fillRect(0, 0, W, H)
    if (!surface) this.drawGlow()
    // far off, beneath the chart: a whale, now and then
    else this.whale.draw(ctx, pal, bg)

    const settle = easeInOutCubic(st.settle)
    const bandness = smoothstep(0.55, 1, st.spread) * (1 - smoothstep(0, 0.45, st.gather))
    const ch3 = smoothstep(0.35, 1, st.curl)

    // echoes of the vortex — the same contours, slightly displaced in scale
    if (ch3 > 0.01 && st.bloom > 0.01) this.drawEchoes(ink, ch3 * st.bloom * (1 - settle * 0.6))

    // contours / records
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const baseA = surface ? 0.5 : 0.44
    const indexA = surface ? 0.92 : 0.84
    const heard = listen.target?.kind === 'record' ? listen.target.line : -1
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i]
      if (!L.path) continue
      const intro = smoothstep(0, 0.2, stagger(st.intro, L.k, 0.75))
      let color = ink
      let alpha = (L.index ? indexA : baseA) * intro
      let width = L.index ? 1.3 : 0.75
      if (L.highlight && bandness > 0) {
        color = mix(ink, pal.accent, bandness)
        alpha = lerp(alpha, 0.95, bandness)
        width = lerp(width, 1.15, bandness)
      }
      if (L.echo) {
        color = pal.accentGlow
        alpha = surface ? 0.75 : lerp(0.6, 0.95, bandness)
        width = 1.25
      }
      if (this.answer > 0.01 && (L.highlight || i === this.answerLine)) {
        // call and response: the two voices light alternately
        const beat = 0.5 + 0.5 * Math.sin(this.time * 2.2 + (L.highlight ? 0 : Math.PI))
        const a = this.answer * (0.45 + 0.55 * beat)
        color = mix(color, pal.accentGlow, a)
        alpha = lerp(alpha, 1, a)
        width = lerp(width, 1.6, a)
      }
      if (i === heard && listen.strength > 0.001) {
        const ls = listen.strength * bandness
        color = mix(color, pal.accentGlow, ls)
        alpha = lerp(alpha, 1, ls)
        width = lerp(width, 1.5, ls)
      }
      ctx.strokeStyle = rgba(color, alpha)
      ctx.lineWidth = width
      ctx.stroke(L.path)
    }

    if (ch3 > 0.01) this.drawCrests(ch3)

    // annotations
    const marks1 = st.introMarks * (1 - smoothstep(0, 0.3, st.unroll))
    if (marks1 > 0.01) this.drawChapter1Marks(ink, soft, bg, marks1)
    if (bandness > 0.01) this.drawChapter2Marks(ink, soft, bg, bandness)
    if (ch3 > 0.01) this.drawChapter3Marks(ink, soft, bg, ch3, settle)

    if (surface) {
      this.drawKnockouts(bg)
      if (this.skylight) {
        ctx.fillStyle = this.skylight
        ctx.fillRect(0, 0, W, H)
      }
    } else if (this.vignette) {
      ctx.fillStyle = this.vignette
      ctx.fillRect(0, 0, W, H)
    }

    if (this.grain) {
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = surface ? 0.075 : 0.06
      ctx.fillStyle = this.grain
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  /** Contours break around the display title, as they would around a map label. */
  private drawKnockouts(bg: RGB) {
    const { ctx } = this
    const spaced = ctx as CanvasRenderingContext2D & { letterSpacing: string }
    for (const k of this.knockouts) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(k.clip.x, k.clip.y, k.clip.w, k.clip.h)
      ctx.clip()
      ctx.font = k.font
      spaced.letterSpacing = `${k.spacing}px`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 20
      ctx.strokeStyle = rgba(bg, k.alpha)
      ctx.fillStyle = rgba(bg, k.alpha)
      ctx.strokeText(k.text, k.x, k.y)
      ctx.fillText(k.text, k.x, k.y)
      ctx.restore()
    }
  }

  private drawGlow() {
    // A faint warmth gathering at the still point as the deep "wakes".
    const st = story
    const a = smoothstep(0.3, 1, st.curl) * (0.05 + 0.11 * st.bloom) * (1 - st.settle * 0.45)
    if (a < 0.003) return
    const { ctx } = this
    const settle = easeInOutCubic(st.settle)
    const cx = lerp(this.c3x, this.c4x, settle) + this.camX * 0.35
    const cy = lerp(this.c3y, this.c4y, settle) + this.camY * 0.35
    const r = lerp(this.r3max * 0.75, this.r4max * 2.2, settle)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, rgba(this.pal.accent, a))
    g.addColorStop(1, rgba(this.pal.accent, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.W, this.H)
  }

  private drawEchoes(ink: RGB, strength: number) {
    const { ctx, lines, dpr } = this
    const settle = easeInOutCubic(story.settle)
    const cx = lerp(this.c3x, this.c4x, settle)
    const cy = lerp(this.c3y, this.c4y, settle)
    const breathe = Math.sin(this.time * 0.9)
    ctx.lineWidth = 0.6
    for (let e = -1; e <= 1; e += 2) {
      const sc = 1 + e * (0.022 + 0.01 * breathe) * strength
      const ro = e * 0.035 * strength
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.translate(cx, cy)
      ctx.rotate(ro)
      ctx.scale(sc, sc)
      ctx.translate(-cx, -cy)
      ctx.strokeStyle = rgba(ink, 0.13 * strength)
      for (const L of lines) if (L.path && !L.index) ctx.stroke(L.path)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** Two tidal crests (semi-diurnal) travelling round every contour as spiral arms. */
  private drawCrests(ch3: number) {
    const { lines, pal } = this
    const st = story
    const strength = ch3 * (0.25 + 0.75 * st.bloom) * (1 - 0.35 * easeInOutCubic(st.settle))
    if (strength < 0.01) return
    const N = lines.length
    for (let i = 0; i < N; i++) {
      const L = lines[i]
      if (!L.path) continue
      const curlK = easeInOutSine(stagger(st.curl, L.k, 0.65))
      const s = strength * curlK * curlK * (0.35 + 0.65 * L.k)
      if (s < 0.02) continue
      for (let c = 0; c < 2; c++) {
        const phi = this.tide + L.k * 2.1 + c * Math.PI
        // screen angle φ = π/2 − a  →  u = (π/2 − φ) / τ + 1/2
        const u = fract((Math.PI / 2 - phi) / TAU + 0.5)
        const centre = u * (L.n - 1)
        this.strokeSpan(L, centre, L.n * 0.05, rgba(pal.accent, 0.1 * s), 4.5)
        this.strokeSpan(L, centre, L.n * 0.034, rgba(pal.accent, 0.42 * s), 1.8)
        this.strokeSpan(L, centre, L.n * 0.02, rgba(pal.accentGlow, 0.9 * s), 1.1)
      }
    }
  }

  private strokeSpan(L: Line, centre: number, half: number, style: string, width: number) {
    const { ctx } = this
    const n = L.n
    const j0 = Math.round(centre - half)
    const j1 = Math.round(centre + half)
    ctx.beginPath()
    for (let j = j0; j <= j1; j++) {
      // wrap around the closed contour
      const jj = ((j % (n - 1)) + (n - 1)) % (n - 1)
      if (j === j0) ctx.moveTo(L.xs[jj], L.ys[jj])
      else ctx.lineTo(L.xs[jj], L.ys[jj])
    }
    ctx.strokeStyle = style
    ctx.lineWidth = width
    ctx.stroke()
  }

  // ─────────────────────────────────────────────────── annotations

  private label(text: string, x: number, y: number, color: string, halo: string, align: CanvasTextAlign = 'left') {
    const { ctx } = this
    ctx.textAlign = align
    ctx.lineWidth = 4
    ctx.strokeStyle = halo
    ctx.strokeText(text, x, y)
    ctx.fillStyle = color
    ctx.fillText(text, x, y)
  }

  private setMono(size: number) {
    const { ctx } = this
    ctx.font = `400 ${size}px ${MONO}`
    ctx.textBaseline = 'middle'
    ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.12em'
  }

  /** Bezel of 60 ticks — a tide clock — around a centre. */
  private drawBezel(cx: number, cy: number, R: number, ink: RGB, soft: RGB, bg: RGB, alpha: number, labels: boolean) {
    const { ctx } = this
    ctx.beginPath()
    for (let i = 0; i < 60; i++) {
      const a = -Math.PI / 2 + (i / 60) * TAU
      const major = i % 5 === 0
      const r0 = R
      const r1 = R + (major ? 10 : 4)
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    }
    ctx.strokeStyle = rgba(ink, 0.5 * alpha)
    ctx.lineWidth = 0.75
    ctx.stroke()
    if (!labels) return
    this.setMono(9.5)
    const safe = Math.max(64, this.H * 0.085)
    for (let h = 0; h < 12; h += 3) {
      const a = -Math.PI / 2 + (h / 12) * TAU
      const r = R + 24
      const ly = cy + Math.sin(a) * r
      const lx = cx + Math.cos(a) * r
      if (ly < safe || ly > this.H - safe || lx < 24 || lx > this.W - 24) continue
      this.label(String(h).padStart(2, '0'), lx, ly, rgba(soft, alpha), rgba(bg, 0.9 * alpha), 'center')
    }
  }

  private drawTideHand(cx: number, cy: number, R: number, bg: RGB, alpha: number, withLabel: boolean) {
    const { ctx, pal } = this
    const a = this.tide
    const ex = cx + Math.cos(a) * R
    const ey = cy + Math.sin(a) * R
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6)
    ctx.lineTo(ex, ey)
    ctx.strokeStyle = rgba(pal.accent, 0.9 * alpha)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(ex, ey, 2.4, 0, TAU)
    ctx.fillStyle = rgba(pal.accent, alpha)
    ctx.fill()
    if (!withLabel || !this.highWater) return
    const txt = `NEXT HW ${this.highWater}`
    this.setMono(9.5)
    const safe = Math.max(64, this.H * 0.085) + 6
    const lx = clamp(cx + Math.cos(a) * (R + 30), 70, this.W - 70)
    const ly = clamp(cy + Math.sin(a) * (R + 30), safe, this.H - safe)
    this.label(txt, lx, ly, rgba(pal.accent, alpha), rgba(bg, 0.85 * alpha), 'center')
  }

  private drawStillPoint(x: number, y: number, ink: RGB, alpha: number) {
    const { ctx, pal } = this
    ctx.beginPath()
    ctx.arc(x, y, 3.2, 0, TAU)
    ctx.strokeStyle = rgba(pal.accent, alpha)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - 12, y)
    ctx.lineTo(x - 6, y)
    ctx.moveTo(x + 6, y)
    ctx.lineTo(x + 12, y)
    ctx.moveTo(x, y - 12)
    ctx.lineTo(x, y - 6)
    ctx.moveTo(x, y + 6)
    ctx.lineTo(x, y + 12)
    ctx.strokeStyle = rgba(ink, 0.8 * alpha)
    ctx.lineWidth = 0.75
    ctx.stroke()
  }

  private drawChapter1Marks(ink: RGB, soft: RGB, bg: RGB, alpha: number) {
    const inner = this.lines[0]
    const depthIn = 0.35
    const sx = inner.c1x + this.camX * depthIn
    const sy = inner.c1y + this.camY * depthIn
    const ox = this.c1x + this.camX
    const oy = this.c1y + this.camY
    const bezelR = this.r1max + (this.mobile ? 30 : 44)

    this.drawBezel(ox, oy, bezelR, ink, soft, bg, alpha, true)
    this.drawTideHand(sx, sy, bezelR - 4, bg, alpha, true)
    this.drawStillPoint(sx, sy, ink, alpha)

    if (this.mobile) return
    this.setMono(9.5)
    const c = rgba(soft, alpha)
    const h = rgba(bg, 0.85 * alpha)
    this.label('AMPHIDROME Nº 07', sx + 18, sy + 22, rgba(ink, alpha), h)
    this.label('STILL POINT · 0.00 M', sx + 18, sy + 36, c, h)
    this.label('TIDE CLOCK · SET BY THE MOON', sx + 18, sy + 50, rgba(this.pal.accent, alpha), h)

    // co-range values on the index contours, read along one bearing
    let level = 0
    for (const L of this.lines) {
      if (!L.index) continue
      level++
      const u = 0.5 + 0.12 // bearing to the lower right of the lowest point
      const j = Math.round(u * (L.n - 1))
      this.label(`${(level * 0.8).toFixed(1)} M`, L.xs[j] + 6, L.ys[j] + 10, c, h)
    }
  }

  private drawChapter2Marks(ink: RGB, soft: RGB, bg: RGB, alpha: number) {
    const { ctx, W, pal, lines } = this
    const st = story
    const h = rgba(bg, 0.85 * alpha)
    this.setMono(this.mobile ? 8.5 : 9.5)

    // record numbers on the index records, set flush right
    const xLabel = W - (this.mobile ? 20 : 56)
    const uLabel = (xLabel + 0.07 * W) / (1.14 * W)
    lines.forEach((L, i) => {
      if (!L.path || !L.index) return
      const j = Math.round(uLabel * (L.n - 1))
      this.label(recordId(i), xLabel, L.ys[j] - 9, rgba(soft, alpha), h, 'right')
    })

    // archive annotations surface one by one as the records disperse;
    // each pulses as the read head plays it
    const N = lines.length
    const head = readHeadU(st.read)
    const headVis = smoothstep(0, 0.06, st.read) * (1 - smoothstep(0.94, 1, st.read))
    RECORDS.forEach((rec, r) => {
      const appear = smoothstep(0.08 + r * 0.17, 0.2 + r * 0.17, st.disperse) * alpha
      if (appear < 0.01) return
      const L = lines[recordLine(rec.k, N)]
      if (!L?.path) return
      const j = Math.round(rec.u * (L.n - 1))
      const x = L.xs[j]
      const y = L.ys[j]
      const lift = this.mobile ? 26 : 38
      ctx.beginPath()
      ctx.moveTo(x, y - 5)
      ctx.lineTo(x, y - lift * appear)
      ctx.strokeStyle = rgba(ink, 0.55 * appear)
      ctx.lineWidth = 0.75
      ctx.stroke()
      const played = Math.exp(-(((head - rec.u) / 0.022) ** 2)) * headVis * appear
      ctx.beginPath()
      ctx.arc(x, y, 2.6 + 2.4 * played, 0, TAU)
      ctx.fillStyle = rgba(pal.accent, appear)
      ctx.fill()
      if (played > 0.02) {
        ctx.beginPath()
        ctx.arc(x, y, 6 + 18 * (1 - played), 0, TAU)
        ctx.strokeStyle = rgba(pal.accent, 0.7 * played)
        ctx.lineWidth = 0.8
        ctx.stroke()
      }
      if (this.mobile && r % 2 === 1) return
      // while this record is being listened to, the caption speaks for it
      const line = recordLine(rec.k, N)
      const quiet = listen.target?.kind === 'record' && listen.target.line === line ? 1 - listen.strength : 1
      if (quiet < 0.02) return
      const flip = x + ctx.measureText(rec.note).width + 24 > W - (this.mobile ? 20 : 56)
      const tx = flip ? x - 8 : x + 8
      const align: CanvasTextAlign = flip ? 'right' : 'left'
      const id = recordId(lines.indexOf(L))
      const ta = appear * quiet
      this.label(id, tx, y - lift + 4, rgba(ink, ta), rgba(bg, 0.85 * ta), align)
      this.label(rec.note, tx, y - lift + 18, rgba(soft, ta), rgba(bg, 0.85 * ta), align)
    })

    // the visitor's own record, newest of all
    if (this.echo && this.echoLine >= 0) {
      const L = lines[this.echoLine]
      const quiet = listen.target?.kind === 'record' && listen.target.line === this.echoLine ? 1 - listen.strength : 1
      const ea = alpha * this.echo.reveal * quiet
      if (L.path && ea > 0.01) {
        const j = Math.round(0.86 * (L.n - 1))
        const x = L.xs[j]
        const y = L.ys[j]
        ctx.beginPath()
        ctx.arc(x, y, 3, 0, TAU)
        ctx.fillStyle = rgba(pal.accentGlow, ea)
        ctx.fill()
        const date = new Date(this.echo.date)
          .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          .toUpperCase()
        this.label(recordId(this.echoLine), x - 10, y - 26, rgba(pal.accentGlow, ea), rgba(bg, 0.85 * ea), 'right')
        this.label(`YOUR ECHO · ${date}`, x - 10, y - 12, rgba(soft, ea), rgba(bg, 0.85 * ea), 'right')
      }
    }

    // the read head
    const readVis = smoothstep(0, 0.06, st.read) * (1 - smoothstep(0.94, 1, st.read)) * alpha
    if (readVis > 0.01) {
      const xr = lerp(W * 0.06, W * 0.94, st.read)
      ctx.beginPath()
      ctx.moveTo(xr, this.b0 - 34)
      ctx.lineTo(xr, this.b1 + 18)
      ctx.strokeStyle = rgba(pal.accent, 0.75 * readVis)
      ctx.lineWidth = 0.9
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(xr - 4, this.b0 - 34)
      ctx.lineTo(xr + 4, this.b0 - 34)
      ctx.stroke()
      const hl = lines.findIndex((L) => L.highlight)
      const id = hl >= 0 ? recordId(hl) : ''
      this.label(`READING ${id}`, xr + 8, this.b0 - 34, rgba(pal.accent, readVis), rgba(bg, 0.85 * readVis))
    }
  }

  private drawChapter3Marks(ink: RGB, soft: RGB, bg: RGB, alpha: number, settle: number) {
    const { ctx, pal } = this
    const cx = lerp(this.c3x, this.c4x, settle) + this.camX * 0.35
    const cy = lerp(this.c3y, this.c4y, settle) + this.camY * 0.35
    const R = lerp(this.r3max, this.r4max, settle)
    const rIn = R * 0.09

    // cotidal lines: the twelve hours of high water radiating from the still point
    ctx.beginPath()
    for (let hr = 0; hr < 12; hr++) {
      const a = -Math.PI / 2 + (hr / 12) * TAU
      ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn)
      ctx.lineTo(cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 14))
    }
    ctx.strokeStyle = rgba(ink, (0.1 + 0.08 * settle) * alpha)
    ctx.lineWidth = 0.6
    ctx.stroke()

    const marks = smoothstep(0.55, 1, settle) * alpha
    if (marks > 0.01) {
      const ox = this.c4x + this.camX
      const oy = this.c4y + this.camY
      this.drawBezel(ox, oy, this.r4max + (this.mobile ? 22 : 30), ink, soft, bg, marks, true)
    }
    this.drawTideHand(cx, cy, R + (settle > 0.5 ? (this.mobile ? 18 : 26) : 10), bg, alpha * (0.5 + 0.5 * settle), settle > 0.6)

    // the still point, now lit
    ctx.beginPath()
    ctx.arc(cx, cy, 2.6, 0, TAU)
    ctx.fillStyle = rgba(pal.accentGlow, alpha)
    ctx.fill()
    this.drawStillPoint(cx, cy, ink, alpha * 0.9)
  }

  // ─────────────────────────────────────────────────────── water line

  private buildWater() {
    const { W } = this
    const step = 14
    const top = new Path2D()
    const bottom = new Path2D()
    const edge = new Path2D()
    const echoes = [new Path2D(), new Path2D(), new Path2D()]
    top.moveTo(-10, -10)
    top.lineTo(W + 10, -10)
    const pts: number[] = []
    for (let x = W + 10; x >= -10; x -= step) pts.push(x, this.waterY(x))
    for (let p = 0; p < pts.length; p += 2) top.lineTo(pts[p], pts[p + 1])
    top.closePath()

    bottom.moveTo(-10, this.H + 10)
    bottom.lineTo(W + 10, this.H + 10)
    for (let p = 0; p < pts.length; p += 2) bottom.lineTo(pts[p], pts[p + 1])
    bottom.closePath()

    for (let p = 0; p < pts.length; p += 2) {
      if (p === 0) edge.moveTo(pts[p], pts[p + 1])
      else edge.lineTo(pts[p], pts[p + 1])
      echoes.forEach((e, ei) => {
        const off = (ei + 1) * (7 + ei * 4)
        const yy = pts[p + 1] + off + Math.sin(pts[p] * 0.02 + this.time * (1 + ei)) * (ei + 1)
        if (p === 0) e.moveTo(pts[p], yy)
        else e.lineTo(pts[p], yy)
      })
    }
    this.waterTop = top
    this.waterBottom = bottom
    this.waterEdge = edge
    this.waterEcho = echoes
  }

  private drawWaterEdge() {
    const { ctx, pal } = this
    const fade = Math.sin(Math.PI * story.water)
    ctx.lineWidth = 1.1
    ctx.strokeStyle = rgba(pal.accent, 0.95)
    ctx.stroke(this.waterEdge!)
    ctx.lineWidth = 0.7
    this.waterEcho.forEach((e, i) => {
      ctx.strokeStyle = rgba(pal.deepInk, (0.4 - i * 0.11) * fade)
      ctx.stroke(e)
    })
  }

  /** Lets the cursor layer split its colour at the same water line. */
  getWaterPaths() {
    const w = story.water
    if (w <= 0.0001 || w >= 0.9999) return null
    return { top: this.waterTop!, bottom: this.waterBottom! }
  }
}

function fract(v: number) {
  return v - Math.floor(v)
}
