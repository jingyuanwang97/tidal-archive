import { makeImpulse, makeKit, type Kit } from './buffers'
import { Voice, makeVoice } from './voices'
import narration from './narration.json'
import { story } from '../engine/story'
import { RECORDS, readHeadU, type NarrationKey, type VoiceKind } from '../engine/records'
import { waveHarmonics } from '../engine/echo'
import { clamp, lerp, smoothstep } from '../engine/math'

/**
 * The sound of the archive, generated live with Web Audio.
 *
 *  ambient  ─┐                       ┌─► reverb ─┐
 *  records  ─┼─► (ducked) ─► master ─┤           ├─► compressor ─► out
 *  listen   ─┤  (analysed first)     │           │
 *  narrator ─┴───────────────────────┴───────────┘
 *
 * Ambient follows the story: surface sea → muffled under the water line →
 * a low drone and pressure in the deep → a harmonic chord that swells with
 * the chapter-03 crests. Everything has a place in the stereo field: records
 * sit where they are drawn, the read head travels left to right, the chord's
 * harmonics circle the listener as the crests turn. A narrator (pre-generated
 * with Kokoro TTS) speaks at the chapter thresholds and reads held records.
 */

interface Ambient {
  surfaceGain: GainNode
  surfaceFilter: BiquadFilterNode
  foamGain: GainNode
  deepGain: GainNode
  droneFilter: BiquadFilterNode
  rumbleGain: GainNode
  scrubGain: GainNode
  scrubFilter: BiquadFilterNode
  scrubPan: StereoPannerNode
  chordGain: GainNode
  chordFilter: BiquadFilterNode
  partials: { gain: GainNode; pan: StereoPannerNode }[]
}

interface Speaking {
  src: AudioBufferSourceNode
  gain: GainNode
  priority: number
}

export interface SpeakOptions {
  /** Higher interrupts lower; equal or lower waits its turn (and is dropped). */
  priority?: number
  subtitle?: boolean
  delay?: number
}

const MASTER_LEVEL = 0.9
const LINES = narration.lines as Record<NarrationKey, string>

/** Screen x (0..1) → stereo position, kept off the extreme edges. */
const panFor = (x01: number) => clamp((x01 - 0.5) * 1.6, -0.85, 0.85)
/** Where a record sits along chapter 02, as a 0..1 screen position. */
const recordX = (u: number) => -0.07 + 1.14 * u

export class SoundEngine {
  ctx: AudioContext | null = null
  enabled = false
  /** Called with the narrator's words while a line plays, and null after. */
  onSubtitle: ((text: string | null) => void) | null = null
  /** When the visitor has left an echo before, the descent begins by saying so. */
  returning = false

  private kit!: Kit
  private master!: GainNode
  private ambientBus!: GainNode
  private recordBus!: GainNode
  private listenBus!: GainNode
  private listenPan!: StereoPannerNode
  private voiceBus!: GainNode
  private reverbSend!: GainNode
  private listenAnalyser!: AnalyserNode
  private outAnalyser!: AnalyserNode
  private ambient: Ambient | null = null
  private oneShots: Voice[] = []
  private held: Voice | null = null
  private speaking: Speaking | null = null
  private buffers = new Map<NarrationKey, Promise<AudioBuffer | null>>()
  private cues = new Set<string>()
  private lastHeadU = -1
  private lastRead = 0
  private readSpeed = 0
  private cooldown = new Map<number, number>()
  private sinceParams = 1
  private pendingEcho: number[] | null = null
  private onVisibility = () => {
    if (!this.ctx) return
    if (document.hidden) this.ctx.suspend()
    else this.ctx.resume()
  }

  /** Create the audio graph. Must run inside a user gesture the first time. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor({ latencyHint: 'playback' })
    this.ctx = ctx
    this.kit = makeKit(ctx)
    if (this.pendingEcho) this.setEcho(this.pendingEcho)

    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 3
    comp.attack.value = 0.02
    comp.release.value = 0.4
    this.outAnalyser = ctx.createAnalyser()
    this.outAnalyser.fftSize = 512
    comp.connect(this.outAnalyser).connect(ctx.destination)

    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(comp)

    const reverb = ctx.createConvolver()
    reverb.buffer = makeImpulse(ctx)
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.55
    this.reverbSend.connect(reverb).connect(this.master)

    this.ambientBus = ctx.createGain()
    this.ambientBus.connect(this.master)
    this.ambientBus.connect(this.reverbSend)

    this.recordBus = ctx.createGain()
    this.recordBus.gain.value = 0.62
    this.recordBus.connect(this.master)
    this.recordBus.connect(this.reverbSend)

    // the listen bus is analysed before the master, so the drawing can show
    // a held record's waveform even when the sound is turned off
    this.listenBus = ctx.createGain()
    this.listenAnalyser = ctx.createAnalyser()
    this.listenAnalyser.fftSize = 2048
    this.listenAnalyser.smoothingTimeConstant = 0
    this.listenPan = ctx.createStereoPanner()
    this.listenBus.connect(this.listenAnalyser)
    this.listenBus.connect(this.listenPan)
    this.listenPan.connect(this.master)
    this.listenPan.connect(this.reverbSend)

    // the narrator: close and warm, with a little of the deep around him
    this.voiceBus = ctx.createGain()
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 75
    const warm = ctx.createBiquadFilter()
    warm.type = 'lowshelf'
    warm.frequency.value = 190
    warm.gain.value = 3.5
    const air = ctx.createBiquadFilter()
    air.type = 'highshelf'
    air.frequency.value = 6500
    air.gain.value = -2.5
    const voiceSend = ctx.createGain()
    voiceSend.gain.value = 0.35
    this.voiceBus.connect(hp).connect(warm).connect(air)
    air.connect(this.master)
    air.connect(voiceSend).connect(this.reverbSend)

    document.addEventListener('visibilitychange', this.onVisibility)
  }

  setEnabled(on: boolean) {
    this.init()
    if (!this.ctx) return
    this.enabled = on
    if (on && !this.ambient) this.ambient = this.buildAmbient()
    if (on) for (const k of ['descent', 'echo-return', 'memory', 'awakening', 'remembers'] as const) this.load(k)
    else this.hush(0.3)
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setValueAtTime(this.master.gain.value, t)
    this.master.gain.setTargetAtTime(on ? MASTER_LEVEL : 0, t, on ? 0.8 : 0.25)
  }

  /** The visitor's echo becomes a tone colour for its record's voice. */
  setEcho(wave: number[] | null) {
    this.pendingEcho = wave
    if (!this.ctx) return
    if (!wave) {
      this.kit.echo = null
      return
    }
    const { real, imag } = waveHarmonics(wave)
    this.kit.echo = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false })
  }

  // ─────────────────────────────────────────────────────── ambient

  private buildAmbient(): Ambient {
    const ctx = this.ctx!
    const kit = this.kit
    const src = (buf: AudioBuffer, rate = 1) => {
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.loop = true
      s.playbackRate.value = rate
      s.start(0, Math.random() * buf.duration)
      return s
    }
    const osc = (type: OscillatorType, f: number) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      o.start()
      return o
    }
    const gain = (v: number) => {
      const g = ctx.createGain()
      g.gain.value = v
      return g
    }
    const filter = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter()
      b.type = type
      b.frequency.value = f
      b.Q.value = q
      return b
    }
    const panner = (p: number) => {
      const n = ctx.createStereoPanner()
      n.pan.value = p
      return n
    }
    const lfo = (rate: number, depth: number, target: AudioParam) => osc('sine', rate).connect(gain(depth)).connect(target)
    const bus = this.ambientBus

    // the sea at the surface: left and right waves on their own cycles, so the shore is wide
    const surfaceFilter = filter('lowpass', 1300)
    const surfaceGain = gain(0)
    surfaceFilter.connect(surfaceGain).connect(bus)
    for (const [p, r1, r2] of [[-0.7, 0.083, 0.131], [0.7, 0.071, 0.149]] as const) {
      const waves = gain(0.6)
      lfo(r1, 0.3, waves.gain)
      lfo(r2, 0.18, waves.gain)
      src(kit.pink).connect(waves).connect(panner(p)).connect(surfaceFilter)
    }
    const foamGain = gain(0)
    for (const p of [-0.5, 0.5]) {
      const foam = gain(0.5)
      lfo(p < 0 ? 0.083 : 0.071, 0.45, foam.gain)
      src(kit.white).connect(filter('highpass', 4500)).connect(foam).connect(panner(p)).connect(foamGain)
    }
    foamGain.connect(bus)

    // the deep: an open fifth on A, its two sides slightly apart, and the pressure of the water above
    const droneFilter = filter('lowpass', 280, 1.4)
    lfo(0.03, 60, droneFilter.frequency)
    const deepGain = gain(0)
    for (const [f, g, type, p] of [
      [55, 0.5, 'sine', 0],
      [82.41, 0.3, 'sine', -0.35],
      [82.62, 0.3, 'sine', 0.35],
      [110.3, 0.22, 'triangle', -0.25],
      [164.8, 0.08, 'triangle', 0.25],
    ] as const) {
      osc(type, f).connect(gain(g)).connect(panner(p)).connect(droneFilter)
    }
    droneFilter.connect(deepGain).connect(bus)
    const rumbleGain = gain(0)
    src(kit.brown, 0.8).connect(filter('lowpass', 130, 0.9)).connect(rumbleGain).connect(bus)

    // the read head: tape scrubbed across the records, pitched by its speed, travelling left to right
    const scrubFilter = filter('bandpass', 400, 5)
    const scrubGain = gain(0)
    const scrubPan = panner(0)
    src(kit.white).connect(scrubFilter).connect(scrubGain).connect(scrubPan).connect(bus)

    // chapter 03: harmonics of the drone, each swelling — and circling — as a crest passes
    const chordFilter = filter('lowpass', 600)
    const chordGain = gain(0)
    const partials = [2, 3, 4, 5, 6, 8].map((m) => {
      const g = gain(0)
      const pan = panner(0)
      osc('sine', 55 * m).connect(g).connect(pan).connect(chordFilter)
      return { gain: g, pan }
    })
    chordFilter.connect(chordGain).connect(bus)

    return {
      surfaceGain,
      surfaceFilter,
      foamGain,
      deepGain,
      droneFilter,
      rumbleGain,
      scrubGain,
      scrubFilter,
      scrubPan,
      chordGain,
      chordFilter,
      partials,
    }
  }

  /**
   * Called every frame by the engine.
   * @param tide  the tide hand's angle (the chord's harmonics follow the crests)
   * @param listenX  the held record's screen position, 0..1, for its stereo place
   */
  update(dt: number, tide: number, listenX: number) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const v of this.oneShots) v.tick(now)
    this.held?.tick(now)
    this.oneShots = this.oneShots.filter((v) => !v.stopped || v.endsAt > now)

    // read speed (scroll scrubbing) and record triggers
    const st = story
    const speed = Math.abs(st.read - this.lastRead) / Math.max(dt, 1e-3)
    this.lastRead = st.read
    this.readSpeed += (speed - this.readSpeed) * clamp(dt * 10)
    const readVis = smoothstep(0, 0.06, st.read) * (1 - smoothstep(0.94, 1, st.read)) * (1 - st.gather)
    this.triggerRecords(readVis, now)
    this.narrateChapters()

    this.sinceParams += dt
    if (this.sinceParams < 1 / 30) return
    this.sinceParams = 0
    const set = (p: AudioParam, v: number, tc = 0.12) => p.setTargetAtTime(v, now, tc)
    set(this.listenPan.pan, panFor(listenX), 0.08)

    // the archive leans back while a record is being listened to, or the narrator speaks
    const duck = this.held ? 0.4 : this.speaking ? 0.55 : 1
    set(this.ambientBus.gain, duck, 0.3)
    set(this.recordBus.gain, this.speaking ? 0.4 : 0.62, 0.3)
    set(this.listenBus.gain, this.speaking ? 0.6 : 1, 0.25)

    if (!this.ambient) return
    const a = this.ambient
    const under = smoothstep(0.12, 0.7, st.water)
    const settle = st.settle
    const ch3 = smoothstep(0.3, 1, st.curl)
    set(a.surfaceGain.gain, lerp(0.34, 0.06, under) * (1 - 0.6 * ch3))
    set(a.surfaceFilter.frequency, lerp(1300, 230, under))
    set(a.foamGain.gain, lerp(0.045, 0, under))
    set(a.deepGain.gain, under * (0.17 + 0.05 * st.bloom) * (1 - 0.35 * settle))
    set(a.rumbleGain.gain, under * 0.2 * (1 - 0.55 * settle) * (1 - 0.4 * ch3))
    set(a.droneFilter.frequency, lerp(260, 520, st.warm))

    const scrub = clamp(this.readSpeed * 1.6) * readVis
    set(a.scrubGain.gain, scrub * 0.13, 0.05)
    set(a.scrubFilter.frequency, 280 + clamp(this.readSpeed) * 1700, 0.05)
    set(a.scrubPan.pan, panFor(0.06 + 0.88 * st.read), 0.05)

    set(a.chordGain.gain, ch3 * (0.05 + 0.13 * st.bloom) * (1 - 0.45 * settle))
    set(a.chordFilter.frequency, 520 + 2000 * st.bloom * (1 - 0.6 * settle))
    a.partials.forEach(({ gain, pan }, k) => {
      // as the crests turn, each harmonic swells in its own sector; at rest only the fifth remains
      const phase = tide * 2 - k * (Math.PI / 3)
      const keep = k < 2 ? 1 : 1 - settle
      set(gain.gain, (0.25 + 0.75 * (0.5 + 0.5 * Math.cos(phase))) * keep * (1 / (1 + k * 0.6)), 0.25)
      set(pan.pan, 0.65 * Math.sin(phase) * (1 - 0.6 * settle), 0.25)
    })
  }

  private triggerRecords(readVis: number, now: number) {
    const head = readHeadU(story.read)
    const prev = this.lastHeadU
    this.lastHeadU = head
    if (prev < 0 || readVis < 0.3 || !this.enabled) return
    RECORDS.forEach((rec, r) => {
      const crossed = (prev < rec.u && head >= rec.u) || (prev > rec.u && head <= rec.u)
      if (!crossed || now < (this.cooldown.get(r) ?? 0)) return
      this.cooldown.set(r, now + 2.5)
      this.playOnce(rec.kind, 3.2, panFor(recordX(rec.u)))
    })
  }

  /** The narrator marks each threshold of the descent, once per descent. */
  private narrateChapters() {
    if (!this.enabled) return
    const st = story
    const cue = (key: NarrationKey, when: boolean) => {
      if (!when || this.cues.has(key)) return
      this.cues.add(key)
      this.speak(key, { priority: 1 })
    }
    cue(this.returning ? 'echo-return' : 'descent', st.introMarks > 0.95 && st.time < 0.4)
    cue('memory', st.time > 3.0 && st.time < 5.2)
    cue('awakening', st.bloom > 0.35 && st.settle < 0.3)
    cue('remembers', st.settle > 0.85)
    // after a full descent, returning to the surface begins a new one
    if (st.time < 0.05 && this.cues.has('remembers')) this.cues.clear()
  }

  playOnce(kind: VoiceKind, seconds: number, pan = 0) {
    if (!this.ctx) return
    if (this.oneShots.length >= 3) this.oneShots[0].stop(0.4)
    const v = makeVoice(this.kit, kind)
    const p = this.ctx.createStereoPanner()
    p.pan.value = pan
    v.out.connect(p).connect(this.recordBus)
    this.oneShots.push(v)
    setTimeout(() => v.stop(1.4), seconds * 1000)
  }

  /**
   * A whale far off: a muffled splash or the breath of a blow, very quiet,
   * from where it was seen. Never louder than something you might have imagined.
   */
  whaleCue(cue: 'splash' | 'blow', x01: number, size = 1) {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const splash = cue === 'splash'
    const src = ctx.createBufferSource()
    src.buffer = splash ? this.kit.brown : this.kit.pink
    const f = ctx.createBiquadFilter()
    f.type = splash ? 'lowpass' : 'bandpass'
    f.frequency.value = splash ? 380 : 620
    f.Q.value = splash ? 0.7 : 0.8
    const g = ctx.createGain()
    const peak = (splash ? 0.16 : 0.07) * size
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + (splash ? 0.03 : 0.28))
    g.gain.exponentialRampToValueAtTime(0.0008, t + (splash ? 1.9 : 1.7))
    const p = ctx.createStereoPanner()
    p.pan.value = panFor(x01)
    src.connect(f).connect(g).connect(p).connect(this.recordBus)
    src.start(t, Math.random() * 2)
    src.stop(t + 2.1)
  }

  /** The 52 Hz whale is answered: a second, lower voice from the other side. */
  answerWhale() {
    if (!this.ctx) return
    setTimeout(() => this.playOnce('answer', 9, 0.6), 900)
  }

  // ───────────────────────────────────────────────────── narrator

  private load(key: NarrationKey) {
    let p = this.buffers.get(key)
    if (!p && this.ctx) {
      const ctx = this.ctx
      p = fetch(`${import.meta.env.BASE_URL}voice/${key}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null)
      this.buffers.set(key, p)
    }
    return p ?? Promise.resolve(null)
  }

  async speak(key: NarrationKey, opts: SpeakOptions = {}) {
    const { priority = 1, subtitle = true, delay = 0 } = opts
    if (!this.ctx || !this.enabled) return
    if (this.speaking && this.speaking.priority >= priority && priority < 2) return
    const buf = await this.load(key)
    if (!buf || !this.ctx || !this.enabled) return
    if (this.speaking && this.speaking.priority > priority) return
    this.hush(0.25)
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.value = 1
    src.connect(gain).connect(this.voiceBus)
    const at = ctx.currentTime + delay
    src.start(at)
    const me: Speaking = { src, gain, priority }
    this.speaking = me
    if (subtitle) setTimeout(() => this.speaking === me && this.onSubtitle?.(LINES[key]), delay * 1000)
    src.onended = () => {
      if (this.speaking !== me) return
      this.speaking = null
      if (subtitle) this.onSubtitle?.(null)
    }
  }

  /** Stop the narrator (only lines at or below a priority, when given). */
  hush(fade = 0.4, upTo = Infinity) {
    const s = this.speaking
    if (!s || !this.ctx || s.priority > upTo) return
    const t = this.ctx.currentTime
    s.gain.gain.cancelScheduledValues(t)
    s.gain.gain.setValueAtTime(s.gain.gain.value, t)
    s.gain.gain.setTargetAtTime(0, t, fade / 4)
    s.src.stop(t + fade + 0.05)
    this.speaking = null
    this.onSubtitle?.(null)
  }

  // ───────────────────────────────────────────────────── listening

  startHold(kind: VoiceKind) {
    this.init()
    if (!this.ctx) return
    this.stopHold()
    const v = makeVoice(this.kit, kind)
    v.out.connect(this.listenBus)
    this.held = v
  }

  stopHold() {
    this.held?.stop(0.9)
    this.held = null
  }

  /** Fills `into` with the held voice's current waveform; returns its RMS. */
  readListen(into: Float32Array<ArrayBuffer>) {
    if (!this.ctx || this.ctx.state !== 'running') return 0
    this.listenAnalyser.getFloatTimeDomainData(into)
    let sum = 0
    for (let i = 0; i < into.length; i++) sum += into[i] * into[i]
    return Math.sqrt(sum / into.length)
  }

  /** The master output's waveform, for the interface's sound glyph. */
  readOutput(into: Float32Array<ArrayBuffer>) {
    if (!this.ctx || !this.enabled) return false
    this.outAnalyser.getFloatTimeDomainData(into)
    return true
  }

  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.ctx?.close()
    this.ctx = null
    this.ambient = null
    this.held = null
    this.speaking = null
    this.oneShots = []
    this.buffers.clear()
    this.cues.clear()
    this.enabled = false
  }
}
