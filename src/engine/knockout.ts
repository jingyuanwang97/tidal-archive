/**
 * Cartographic knockout: contour lines break where a label sits on them.
 * Reads the live position of the DOM title (including the reveal/exit
 * transforms GSAP applies) so the canvas can clear a halo around each glyph.
 */
export interface Knockout {
  text: string
  font: string
  spacing: number
  x: number
  y: number
  clip: { x: number; y: number; w: number; h: number }
  alpha: number
}

const range = typeof document !== 'undefined' ? document.createRange() : null

export function readKnockouts(title: HTMLElement | null, ctx: CanvasRenderingContext2D): Knockout[] {
  if (!title || !range) return []
  const out: Knockout[] = []
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.textContent ?? ''
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (!text) continue
    const el = node.parentElement!
    const mask = el.closest('.mask') as HTMLElement | null
    if (!mask) continue
    const alpha = mask.style.opacity === '' ? 1 : parseFloat(mask.style.opacity)
    if (!(alpha > 0.01)) continue

    const cs = getComputedStyle(el)
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const shown = cs.textTransform === 'uppercase' ? text.toUpperCase() : text
    ctx.font = font
    const m = ctx.measureText(shown)

    range.setStart(node, lead)
    range.setEnd(node, lead + text.length)
    const r = range.getBoundingClientRect()
    const c = mask.getBoundingClientRect()
    out.push({
      text: shown,
      font,
      spacing: parseFloat(cs.letterSpacing) || 0,
      x: r.left,
      y: r.top + m.fontBoundingBoxAscent,
      clip: { x: c.left - 8, y: c.top - 6, w: c.width + 16, h: c.height + 12 },
      alpha,
    })
  }
  return out
}
