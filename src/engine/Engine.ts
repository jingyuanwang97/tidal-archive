import { gsap } from 'gsap'
import { TidalStage } from './TidalStage'
import { LiquidCursor } from './LiquidCursor'
import { attachPointer, pointer, updatePointer } from './pointer'
import { readPalette, mix, rgba } from './palette'
import { story, TIMELINE, chapterAt } from './story'
import { clamp, damp, smoothstep } from './math'
import { readKnockouts } from './knockout'
import { armTime, attachListen, listen } from './listen'
import { STILL_POINT, recordFor, type RecordInfo } from './records'
import { ECHO_MAX_SECONDS, echoGesture, gestureToWave, saveEcho, type Echo } from './echo'
import type { SoundEngine } from '../audio/SoundEngine'

export interface HudRefs {
  depth: HTMLElement | null
  marker: HTMLElement | null
  /** The interface's sound glyph: a tiny live trace of the output. */
  soundWave: SVGPolylineElement | null
}

export interface CaptionRefs {
  root: HTMLElement | null
  id: HTMLElement | null
  note: HTMLElement | null
  memory: HTMLElement | null
}

export interface EngineOptions {
  stage: HTMLCanvasElement
  cursor: HTMLCanvasElement | null
  reduced: boolean
  hud: HudRefs
  caption: CaptionRefs
  sound: SoundEngine
  onChapter: (index: number) => void
  getIsland: () => DOMRect | null
  getTitle: () => HTMLElement | null
  /** Listening is unavailable until the visitor has entered. */
  canListen: () => boolean
  /** Leaving an echo: the drawing mode changed, or an echo was kept. */
  onEchoMode: (mode: typeof echoGesture.mode) => void
  onEchoKept: (echo: Echo) => void
}

/**
 * One loop for everything that moves every frame. It runs on gsap.ticker so it
 * is in step with the scrubbed scroll timeline, and touches the DOM only
 * through a handful of direct writes (no React renders per frame).
 */
export class Engine {
  private stage: TidalStage
  private cursor: LiquidCursor | null = null
  private detachPointer: () => void
  private detachListen: () => void
  private chapter = -1
  private depthShown = -1
  private hudTop = ''
  private hudBottom = ''
  private ro: ResizeObserver
  private pal = readPalette()
  private measure = document.createElement('canvas').getContext('2d')!
  private waveGain = 4
  private outWave = new Float32Array(512)
  private glyphFlat = false
  private frame = 0
  private echoDate: string | null = null
  private holdTime = 0
  private answered = false
  private answerAge = -1
  private detachEcho: () => void

  constructor(private opts: EngineOptions) {
    this.stage = new TidalStage(opts.stage, this.pal, opts.reduced)
    // the ink layer runs on touch screens too (finger trails, tap drops); only
    // a fine pointer has its native cursor replaced by the reticle
    if (opts.cursor && !opts.reduced) {
      this.cursor = new LiquidCursor(opts.cursor, this.pal)
      if (pointer.fine) document.documentElement.classList.add('has-liquid-cursor')
    }
    this.detachPointer = attachPointer()
    this.detachListen = attachListen({
      blocked: () => !opts.canListen() || echoGesture.mode !== 'off',
      onGesture: () => opts.sound.init(),
    })
    this.detachEcho = this.attachEchoDrawing()
    this.resize()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(document.documentElement)
    gsap.ticker.add(this.tick)
  }

  resize = () => {
    const W = window.innerWidth
    const H = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.stage.resize(W, H, dpr)
    this.cursor?.resize(W, H, dpr)
    this.measureIsland()
  }

  measureIsland() {
    const r = this.opts.getIsland()
    this.stage.setIsland(r ? { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } : null)
  }

  private tick = (_time: number, deltaTime: number) => {
    const dt = Math.min(deltaTime / 1000, 1 / 20)
    this.frame++
    updatePointer(dt)
    this.updateListen(dt)
    this.updateEcho()
    this.updateAnswer(dt)
    // the hero title is only on screen near the top of the story
    this.stage.setKnockouts(story.time < 1.4 ? readKnockouts(this.opts.getTitle(), this.measure) : [])
    this.stage.render(dt)
    this.cursor?.render(dt, this.stage.getWaterPaths(), story.water)
    this.opts.sound.update(dt, this.stage.tideAngle, listen.x / window.innerWidth)
    this.updateCaption()
    this.updateHud()
  }

  // ───────────────────────────────────────────────────── listening

  private updateListen(dt: number) {
    if (listen.pressing && !listen.active) {
      listen.armed = Math.min(1, listen.armed + dt / armTime())
      if (listen.armed >= 1) this.beginListen()
    } else if (!listen.pressing) {
      if (listen.active) this.endListen()
      listen.armed = damp(listen.armed, 0, 10, dt)
    }
    listen.strength = damp(listen.strength, listen.active ? 1 : 0, listen.active ? 5 : 2.5, dt)

    // hold the still point of chapter 03 long enough, and the lonely whale is answered
    if (listen.active && listen.target?.kind === 'still' && story.curl > 0.8) this.holdTime += dt
    else this.holdTime = 0
    if (this.holdTime > 5 && !this.answered) {
      this.answered = true
      this.answerAge = 0
      this.opts.sound.answerWhale()
      this.opts.sound.speak('answered', { priority: 3, subtitle: false, delay: 0.6 })
      const m = this.opts.caption.memory
      if (m) m.textContent = 'For the first time… someone answered.'
    }

    if (listen.strength < 0.002) return
    // the held voice's waveform, auto-gained so quiet records still draw clearly
    const rms = this.opts.sound.readListen(listen.wave)
    if (rms < 1e-4) {
      // no audio running (or blocked): a stand-in trace so the drawing still answers
      const t = performance.now() / 1000
      for (let i = 0; i < listen.wave.length; i++) {
        listen.wave[i] = 0.18 * Math.sin(i * 0.012 + t * 9) + 0.08 * Math.sin(i * 0.051 - t * 5)
      }
      listen.level = damp(listen.level, 0.25, 4, dt)
      return
    }
    let peak = 0
    for (let i = 0; i < listen.wave.length; i++) peak = Math.max(peak, Math.abs(listen.wave[i]))
    this.waveGain = damp(this.waveGain, clamp(0.9 / Math.max(peak, 0.01), 1, 28), 3, dt)
    for (let i = 0; i < listen.wave.length; i++) listen.wave[i] = clamp(listen.wave[i] * this.waveGain, -1.2, 1.2)
    listen.level = damp(listen.level, clamp(rms * 5), 10, dt)
  }

  private beginListen() {
    const ch = chapterAt(story.time)
    let info: RecordInfo
    if (ch === 1) {
      // keyboard listens to the record under the read head; a press, to the nearest record
      let line = listen.source === 'key' ? this.stage.highlightLine : this.stage.pickRecord(listen.x, listen.y)
      if (line < 0) line = this.stage.highlightLine
      if (listen.source === 'key') {
        listen.x = window.innerWidth * 0.62
        listen.y = this.stage.lineYAt(line, listen.x) ?? window.innerHeight / 2
      }
      listen.target = { kind: 'record', line }
      info = recordFor(line, this.stage.lineCount, this.echoDate)
    } else {
      if (listen.source === 'key') {
        listen.x = window.innerWidth / 2
        listen.y = window.innerHeight / 2
      }
      listen.target = { kind: 'still' }
      info = story.water < 0.5 ? STILL_POINT.surface : STILL_POINT.deep
    }
    listen.active = true
    this.opts.sound.startHold(info.kind)
    // the narrator reads the record's memory, once the listen has settled in
    this.opts.sound.speak(info.voice, { priority: 2, subtitle: false, delay: 0.9 })
    const { caption } = this.opts
    if (caption.id) caption.id.textContent = info.id
    if (caption.note) caption.note.textContent = info.note
    if (caption.memory) caption.memory.textContent = info.memory
  }

  private endListen() {
    listen.active = false
    this.opts.sound.stopHold()
    this.opts.sound.hush(0.5, 2)
  }

  private updateAnswer(dt: number) {
    if (this.answerAge < 0) return
    this.answerAge += dt
    // the two voices light together for a while, then the archive keeps it
    this.stage.answer = smoothstep(0, 1.5, this.answerAge) * (1 - smoothstep(10, 14, this.answerAge))
    if (this.answerAge > 14) this.answerAge = -1
    // after a full new descent the whale can be answered again
    if (story.time < 0.05) this.answered = false
  }

  // ─────────────────────────────────────────────────── leaving an echo

  setEcho(echo: Echo | null, animate = false) {
    this.echoDate = echo?.date ?? null
    this.stage.setEcho(echo, animate)
  }

  /** Waits for the visitor's press; then the gesture is drawn until release. */
  beginEcho() {
    echoGesture.mode = 'ready'
    echoGesture.points = []
    document.documentElement.classList.add('is-drawing')
    this.opts.onEchoMode('ready')
    this.opts.sound.speak('echo-invite', { priority: 3 })
  }

  cancelEcho() {
    echoGesture.mode = 'off'
    document.documentElement.classList.remove('is-drawing')
    this.opts.onEchoMode('off')
  }

  private attachEchoDrawing() {
    const down = (e: PointerEvent) => {
      if (echoGesture.mode !== 'ready' || (e.target as Element | null)?.closest?.('button, a')) return
      echoGesture.mode = 'drawing'
      echoGesture.started = performance.now()
      echoGesture.points = [{ x: e.clientX, y: e.clientY }]
      this.opts.onEchoMode('drawing')
    }
    const move = (e: PointerEvent) => {
      if (echoGesture.mode !== 'drawing') return
      const last = echoGesture.points[echoGesture.points.length - 1]
      if (Math.hypot(e.clientX - last.x, e.clientY - last.y) > 2) echoGesture.points.push({ x: e.clientX, y: e.clientY })
    }
    const up = () => {
      if (echoGesture.mode === 'drawing') this.finishEcho()
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }

  private updateEcho() {
    if (echoGesture.mode === 'drawing' && performance.now() - echoGesture.started > ECHO_MAX_SECONDS * 1000) this.finishEcho()
  }

  private finishEcho() {
    const wave = gestureToWave(echoGesture.points)
    if (!wave) {
      // too short to keep: wait for another, longer gesture
      echoGesture.mode = 'ready'
      echoGesture.points = []
      this.opts.onEchoMode('ready')
      return
    }
    const echo: Echo = { date: new Date().toISOString(), wave }
    saveEcho(echo)
    this.setEcho(echo, true)
    const { sound } = this.opts
    sound.setEcho(wave)
    sound.playOnce('echo', 5.5)
    sound.speak('echo-kept', { priority: 3, delay: 0.4 })
    echoGesture.mode = 'off'
    document.documentElement.classList.remove('is-drawing')
    this.opts.onEchoMode('off')
    this.opts.onEchoKept(echo)
  }

  private updateCaption() {
    const el = this.opts.caption.root
    if (!el) return
    const s = listen.strength
    if (s < 0.01) {
      if (el.style.opacity !== '0') el.style.opacity = '0'
      return
    }
    const W = window.innerWidth
    const H = window.innerHeight
    // pinned beside the held record (or the pointer), kept inside the frame
    let ax = listen.x
    let ay = listen.y
    if (listen.target?.kind === 'record') ay = this.stage.lineYAt(listen.target.line, ax) ?? ay
    const w = el.offsetWidth
    const h = el.offsetHeight
    const right = ax + 28 + w < W - 24
    const x = clamp(right ? ax + 28 : ax - 28 - w, 16, W - w - 16)
    const y = clamp(ay - h - (listen.touch ? 64 : 26), 72, H - h - 72)
    el.style.opacity = s.toFixed(3)
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${(y + (1 - s) * 8).toFixed(1)}px, 0)`
  }

  // ───────────────────────────────────────────────────────── HUD

  private updateHud() {
    const { hud, onChapter } = this.opts
    const H = window.innerHeight
    const W = window.innerWidth

    // the interface changes ink exactly when the water line passes it
    const wy = this.stage.waterY(W * 0.5)
    const top = story.water >= 1 ? 1 : 1 - smoothstep(18, 64, wy)
    const bottom = story.water >= 1 ? 1 : 1 - smoothstep(H - 64, H - 18, wy)
    const topInk = rgba(mix(this.pal.surfaceInk, this.pal.deepInk, top))
    const botInk = rgba(mix(this.pal.surfaceInk, this.pal.deepInk, bottom))
    const root = document.documentElement.style
    if (topInk !== this.hudTop) {
      root.setProperty('--hud-top', topInk)
      this.hudTop = topInk
    }
    if (botInk !== this.hudBottom) {
      root.setProperty('--hud-bottom', botInk)
      this.hudBottom = botInk
    }

    const p = story.time / TIMELINE.total
    // the descent: 0 m at the surface to the abyssal plain at 4 200 m
    const depth = Math.round(Math.pow(Math.min(1, Math.max(0, p)), 1.25) * 4200)
    if (depth !== this.depthShown && hud.depth) {
      hud.depth.textContent = String(depth).padStart(4, '0')
      this.depthShown = depth
    }
    if (hud.marker) hud.marker.style.transform = `scaleX(${Math.max(0.0001, p).toFixed(4)})`
    this.updateSoundGlyph()

    const ch = chapterAt(story.time)
    if (ch !== this.chapter) {
      this.chapter = ch
      document.documentElement.dataset.chapter = String(ch + 1)
      onChapter(ch)
    }
  }

  /** A 26 × 12 trace of what the archive is sounding, or a flat line when silent. */
  private updateSoundGlyph() {
    const line = this.opts.hud.soundWave
    if (!line || this.frame % 2) return
    const live = this.opts.sound.readOutput(this.outWave)
    if (!live) {
      if (!this.glyphFlat) {
        line.setAttribute('points', '0,6 26,6')
        this.glyphFlat = true
      }
      return
    }
    this.glyphFlat = false
    let pts = ''
    const step = Math.floor(this.outWave.length / 14)
    for (let i = 0; i <= 13; i++) {
      const v = clamp(this.outWave[i * step] * 14, -5, 5)
      pts += `${(i * 2).toFixed(0)},${(6 - v).toFixed(1)} `
    }
    line.setAttribute('points', pts.trim())
  }

  destroy() {
    gsap.ticker.remove(this.tick)
    this.ro.disconnect()
    this.detachPointer()
    this.detachListen()
    this.detachEcho()
    this.endListen()
    this.cancelEcho()
    document.documentElement.classList.remove('has-liquid-cursor')
  }
}
