// The palette lives in CSS custom properties (src/styles/tokens.css).
// Canvas code reads them once and mixes them numerically.

export type RGB = [number, number, number]

export interface Palette {
  surfaceBg: RGB
  surfaceInk: RGB
  surfaceSoft: RGB
  deepBg: RGB
  deepBgWarm: RGB
  deepInk: RGB
  deepSoft: RGB
  accent: RGB
  accentGlow: RGB
}

function parseHex(value: string): RGB {
  let hex = value.trim().replace('#', '')
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  const n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => parseHex(css.getPropertyValue(name) || '#000')
  return {
    surfaceBg: v('--surface-bg'),
    surfaceInk: v('--surface-ink'),
    surfaceSoft: v('--surface-soft'),
    deepBg: v('--deep-bg'),
    deepBgWarm: v('--deep-bg-warm'),
    deepInk: v('--deep-ink'),
    deepSoft: v('--deep-soft'),
    accent: v('--accent'),
    accentGlow: v('--accent-glow'),
  }
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

export const rgba = (c: RGB, a = 1) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`
