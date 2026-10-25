// Every sound in the archive is synthesized; these are the raw materials.

export interface Kit {
  ctx: AudioContext
  white: AudioBuffer
  pink: AudioBuffer
  brown: AudioBuffer
  /** Sparse clicks with short tails — rain on water. */
  crackle: AudioBuffer
  /** Dense clicks — a reef of snapping shrimp. */
  crackleDense: AudioBuffer
  /** The visitor's echo as a tone colour, when one has been left. */
  echo: PeriodicWave | null
}

function buffer(ctx: AudioContext, seconds: number, fill: (data: Float32Array) => void) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  fill(b.getChannelData(0))
  return b
}

export function makeKit(ctx: AudioContext): Kit {
  const white = buffer(ctx, 3, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  })

  // Paul Kellet's economical pink filter
  const pink = buffer(ctx, 4, (d) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
  })

  const brown = buffer(ctx, 4, (d) => {
    let last = 0
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = last * 3.5
    }
  })

  const clicks = (density: number) =>
    buffer(ctx, 3, (d) => {
      const sr = ctx.sampleRate
      for (let i = 0; i < d.length; i++) {
        if (Math.random() < density / sr) {
          const amp = 0.3 + Math.random() * 0.7
          const len = Math.floor(sr * (0.002 + Math.random() * 0.01))
          for (let j = 0; j < len && i + j < d.length; j++) {
            d[i + j] += amp * (Math.random() * 2 - 1) * Math.exp((-6 * j) / len)
          }
        }
      }
    })

  return { ctx, white, pink, brown, crackle: clicks(220), crackleDense: clicks(1400), echo: null }
}

/** A stereo impulse response: decaying noise, darker as it decays. */
export function makeImpulse(ctx: AudioContext, seconds = 3.4, decay = 2.8) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const k = 0.15 + 0.8 * (1 - t)
      lp = lp + k * ((Math.random() * 2 - 1) - lp)
      d[i] = lp * Math.pow(1 - t, decay)
    }
  }
  return b
}
