import type { Kit } from './buffers'
import type { VoiceKind } from '../engine/records'

/**
 * Voices of the archive. Each one is a small synthesis graph that sustains
 * until stopped, so the same recipe serves a one-shot (the read head passing)
 * and a held listen. Event-based voices schedule ahead from tick().
 */
export class Voice {
  readonly out: GainNode
  private sources: AudioScheduledSourceNode[] = []
  private ticker: ((now: number) => void) | null = null
  stopped = false
  endsAt = Infinity

  constructor(
    readonly kit: Kit,
    level: number,
    attack = 0.4,
  ) {
    const { ctx } = kit
    this.out = ctx.createGain()
    this.out.gain.setValueAtTime(0, ctx.currentTime)
    this.out.gain.setTargetAtTime(level, ctx.currentTime, attack / 3)
  }

  get ctx() {
    return this.kit.ctx
  }

  loop(buf: AudioBuffer, rate = 1) {
    const s = this.ctx.createBufferSource()
    s.buffer = buf
    s.loop = true
    s.playbackRate.value = rate
    s.start(this.ctx.currentTime, Math.random() * buf.duration)
    this.sources.push(s)
    return s
  }

  osc(type: OscillatorType, freq: number) {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.start()
    this.sources.push(o)
    return o
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7) {
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  gain(v: number) {
    const g = this.ctx.createGain()
    g.gain.value = v
    return g
  }

  /** A slow oscillation added onto a parameter. */
  lfo(rate: number, depth: number, target: AudioParam, type: OscillatorType = 'sine') {
    const o = this.osc(type, rate)
    const g = this.gain(depth)
    o.connect(g).connect(target)
    return o
  }

  /** Take ownership of a source created outside the helpers, so stop() ends it. */
  adopt(s: AudioScheduledSourceNode) {
    this.sources.push(s)
  }

  onTick(fn: (now: number) => void) {
    this.ticker = fn
  }

  tick(now: number) {
    if (!this.stopped) this.ticker?.(now)
  }

  stop(fade = 0.6) {
    if (this.stopped) return
    this.stopped = true
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setValueAtTime(this.out.gain.value, t)
    this.out.gain.setTargetAtTime(0, t, fade / 4)
    this.endsAt = t + fade + 0.2
    for (const s of this.sources) s.stop(this.endsAt)
    setTimeout(() => this.out.disconnect(), (fade + 0.4) * 1000)
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** A whale's moan: harmonics of a low fundamental gliding slowly, phrased in breaths. */
function whale(kit: Kit, base: number, glideRate: number, phraseRate: number, level = 0.6) {
  const v = new Voice(kit, level, 0.9)
  const bp = v.filter('bandpass', 320, 1.1)
  v.lfo(0.11, 150, bp.frequency)
  const phrase = v.gain(0.65)
  v.lfo(phraseRate, 0.4, phrase.gain)
  bp.connect(phrase).connect(v.out)
  const glide = v.osc('sine', glideRate)
  const glideDepth = v.gain(320)
  glide.connect(glideDepth)
  const vib = v.osc('sine', 4.8)
  const vibDepth = v.gain(14)
  vib.connect(vibDepth)
  for (const [m, g] of [[1, 0.9], [2, 0.55], [3, 0.42], [4, 0.28], [6, 0.12]]) {
    const o = v.osc('sine', base * m)
    glideDepth.connect(o.detune)
    vibDepth.connect(o.detune)
    o.connect(v.gain(g)).connect(bp)
  }
  return v
}

/** One enveloped burst of a looping buffer, scheduled at time t. */
function burst(v: Voice, buf: AudioBuffer, t: number, dur: number, peak: number, dest: AudioNode) {
  const { ctx } = v
  const s = ctx.createBufferSource()
  s.buffer = buf
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
  s.connect(g).connect(dest)
  s.start(t, Math.random() * (buf.duration - dur - 0.05))
  s.stop(t + dur + 0.05)
}

type Recipe = (kit: Kit) => Voice

const RECIPES: Record<VoiceKind, Recipe> = {
  // a storm surge: a broad, heaving band of noise over a sub-bass swell
  surge(kit) {
    const v = new Voice(kit, 0.55, 0.8)
    const bp = v.filter('bandpass', 380, 0.8)
    v.loop(kit.brown).connect(bp)
    v.lfo(0.13, 260, bp.frequency)
    const body = v.gain(1)
    v.lfo(0.21, 0.55, body.gain)
    bp.connect(body).connect(v.out)
    const lp = v.filter('lowpass', 85, 1)
    v.loop(kit.brown, 0.7).connect(lp).connect(v.gain(1.5)).connect(v.out)
    return v
  },

  // a hull passing: two beating sawtooths at 31 Hz, gliding down (doppler)
  hull(kit) {
    const v = new Voice(kit, 0.42, 1.2)
    const lp = v.filter('lowpass', 240, 5)
    v.lfo(0.05, 90, lp.frequency)
    const t = v.ctx.currentTime
    for (const f of [31, 31.35]) {
      const o = v.osc('sawtooth', f)
      o.detune.setValueAtTime(70, t)
      o.detune.linearRampToValueAtTime(-110, t + 8)
      o.connect(lp)
    }
    const sub = v.osc('sine', 62)
    sub.connect(v.gain(0.4)).connect(v.out)
    lp.connect(v.out)
    return v
  },

  // the 52 Hz whale: a harmonic moan gliding slowly in pitch, phrased in breaths
  song(kit) {
    return whale(kit, 52, 0.16, 0.23)
  },

  // the answer: a second, lower whale, phrasing against the first
  answer(kit) {
    return whale(kit, 46.5, 0.12, 0.19, 0.55)
  },

  // the visitor's echo: their gesture, heard as one period of a tone, breathing slowly
  echo(kit) {
    if (!kit.echo) return RECIPES.swell(kit)
    const v = new Voice(kit, 0.5, 1)
    const lp = v.filter('lowpass', 1600, 0.8)
    v.lfo(0.07, 500, lp.frequency)
    const breath = v.gain(0.7)
    v.lfo(0.27, 0.3, breath.gain)
    lp.connect(breath).connect(v.out)
    const vib = v.osc('sine', 0.21)
    const vibDepth = v.gain(35)
    vib.connect(vibDepth)
    for (const [f, g] of [[110, 0.7], [165.3, 0.32]]) {
      const o = v.ctx.createOscillator()
      o.setPeriodicWave(kit.echo)
      o.frequency.value = f
      vibDepth.connect(o.detune)
      o.start()
      v.adopt(o)
      o.connect(v.gain(g)).connect(lp)
    }
    v.osc('sine', 55).connect(v.gain(0.25)).connect(v.out)
    return v
  },

  // calving ice: a crack, a falling boom, a long rumble — repeated irregularly
  ice(kit) {
    const v = new Voice(kit, 0.75, 0.05)
    const bus = v.gain(1)
    bus.connect(v.out)
    let next = v.ctx.currentTime + 0.05
    v.onTick((now) => {
      while (next < now + 0.3) {
        const t = next
        const hp = v.filter('highpass', 1800)
        hp.connect(bus)
        burst(v, kit.white, t, 0.12, 0.8, hp)
        burst(v, kit.white, t + rand(0.05, 0.14), 0.08, 0.45, hp)
        const o = v.ctx.createOscillator()
        o.frequency.setValueAtTime(74, t + 0.04)
        o.frequency.exponentialRampToValueAtTime(29, t + 1.7)
        const g = v.ctx.createGain()
        g.gain.setValueAtTime(0, t + 0.04)
        g.gain.linearRampToValueAtTime(0.9, t + 0.08)
        g.gain.exponentialRampToValueAtTime(0.0008, t + 2.4)
        o.connect(g).connect(bus)
        o.start(t + 0.04)
        o.stop(t + 2.5)
        const lp = v.filter('lowpass', 160)
        lp.connect(bus)
        burst(v, kit.brown, t + 0.1, 2.8, 1.1, lp)
        next += rand(1.9, 3.2)
      }
    })
    return v
  },

  // rain on open water: sparse clicks, bright, with a soft hiss
  rain(kit) {
    const v = new Voice(kit, 0.5, 0.6)
    v.loop(kit.crackle).connect(v.filter('bandpass', 3600, 0.6)).connect(v.gain(1.4)).connect(v.out)
    v.loop(kit.white).connect(v.filter('highpass', 6000)).connect(v.gain(0.05)).connect(v.out)
    return v
  },

  // a long swell: breathing low noise with a brighter crest
  swell(kit) {
    const v = new Voice(kit, 0.6, 1)
    const body = v.gain(0.55)
    v.lfo(0.085, 0.45, body.gain)
    v.loop(kit.pink).connect(v.filter('lowpass', 420)).connect(body).connect(v.out)
    const crest = v.gain(0.1)
    v.lfo(0.085, 0.1, crest.gain)
    v.loop(kit.pink).connect(v.filter('bandpass', 1300, 0.6)).connect(crest).connect(v.out)
    return v
  },

  // thunder too far away to see: rolling sub-band swells
  thunder(kit) {
    const v = new Voice(kit, 0.85, 0.3)
    const roll = v.gain(0.2)
    v.loop(kit.brown).connect(v.filter('lowpass', 110, 1)).connect(roll).connect(v.out)
    let next = v.ctx.currentTime + 0.2
    v.onTick((now) => {
      while (next < now + 0.3) {
        roll.gain.setTargetAtTime(rand(1, 1.5), next, 0.25)
        roll.gain.setTargetAtTime(0.18, next + rand(0.7, 1.3), 0.9)
        next += rand(2.4, 4.4)
      }
    })
    return v
  },

  // a reef of snapping shrimp: dense, dry crackle
  shrimp(kit) {
    const v = new Voice(kit, 0.4, 0.4)
    v.loop(kit.crackleDense).connect(v.filter('highpass', 2600)).connect(v.out)
    return v
  },

  // sea ice cooling: falling sine "pings" in a wide space
  icesong(kit) {
    const v = new Voice(kit, 0.32, 0.05)
    // the cold hush the pings ring out of
    v.loop(kit.pink).connect(v.filter('bandpass', 900, 0.8)).connect(v.gain(0.35)).connect(v.out)
    let next = v.ctx.currentTime + 0.05
    v.onTick((now) => {
      while (next < now + 0.3) {
        const t = next
        const o = v.ctx.createOscillator()
        const f0 = rand(1600, 2600)
        o.frequency.setValueAtTime(f0, t)
        o.frequency.exponentialRampToValueAtTime(f0 * rand(0.16, 0.3), t + rand(0.18, 0.32))
        const g = v.ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.6, t + 0.006)
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.4)
        o.connect(g).connect(v.out)
        o.start(t)
        o.stop(t + 0.45)
        next += rand(0.3, 0.85)
      }
    })
    return v
  },

  // an anchor chain: FM clanks and a scrape, link by link
  chain(kit) {
    const v = new Voice(kit, 0.4, 0.05)
    // the seabed it drags across
    v.loop(kit.brown).connect(v.filter('lowpass', 220)).connect(v.gain(0.5)).connect(v.out)
    let next = v.ctx.currentTime + 0.05
    v.onTick((now) => {
      while (next < now + 0.3) {
        const t = next
        const car = v.ctx.createOscillator()
        const mod = v.ctx.createOscillator()
        const idx = v.ctx.createGain()
        car.frequency.value = rand(300, 380)
        mod.frequency.value = car.frequency.value * 2.51
        idx.gain.setValueAtTime(900, t)
        idx.gain.exponentialRampToValueAtTime(20, t + 0.5)
        mod.connect(idx).connect(car.frequency)
        const g = v.ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.7, t + 0.003)
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.7)
        car.connect(g).connect(v.out)
        car.start(t)
        mod.start(t)
        car.stop(t + 0.75)
        mod.stop(t + 0.75)
        const bp = v.filter('bandpass', 1100, 2)
        bp.connect(v.out)
        burst(v, kit.white, t + 0.02, 0.35, 0.25, bp)
        next += rand(0.8, 1.5)
      }
    })
    return v
  },

  // a school turning at once: a bandpassed rush sweeping back and forth
  school(kit) {
    const v = new Voice(kit, 0.45, 0.5)
    const bp = v.filter('bandpass', 1200, 3)
    v.lfo(0.55, 900, bp.frequency)
    const amp = v.gain(0.6)
    v.lfo(0.55, 0.4, amp.gain)
    v.loop(kit.pink).connect(bp).connect(amp).connect(v.out)
    return v
  },

  // the still point: an open fifth, barely breathing, over the sea floor
  still(kit) {
    const v = new Voice(kit, 0.5, 1.2)
    const lp = v.filter('lowpass', 900)
    const trem = v.gain(0.65)
    v.lfo(0.4, 0.3, trem.gain)
    lp.connect(trem).connect(v.out)
    for (const [f, g, type] of [[110, 0.3, 'triangle'], [220, 0.45, 'sine'], [330, 0.28, 'sine'], [440.6, 0.1, 'sine']] as const) {
      v.osc(type, f).connect(v.gain(g)).connect(lp)
    }
    v.loop(kit.pink).connect(v.filter('lowpass', 300)).connect(v.gain(0.4)).connect(v.out)
    return v
  },

  // every record at once: the whale, the swell and a bright harmonic halo
  chorus(kit) {
    const v = new Voice(kit, 0.75, 1.2)
    const song = RECIPES.song(kit)
    const swell = RECIPES.swell(kit)
    song.out.connect(v.out)
    swell.out.connect(v.out)
    const halo = v.gain(0.12)
    v.lfo(0.2, 0.06, halo.gain)
    for (const f of [275, 412.5, 550, 660]) v.osc('sine', f).connect(halo)
    halo.connect(v.out)
    const stop = v.stop.bind(v)
    v.stop = (fade = 0.6) => {
      song.stop(fade)
      swell.stop(fade)
      stop(fade)
    }
    return v
  },
}

export function makeVoice(kit: Kit, kind: VoiceKind) {
  return RECIPES[kind](kit)
}
