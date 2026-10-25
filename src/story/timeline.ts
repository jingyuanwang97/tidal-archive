import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { story, TIMELINE } from '../engine/story'

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin)

/**
 * Motion language
 *  Primary   — the motif's transformations: long, linear on the timeline,
 *              eased per line inside the engine.
 *  Secondary — type surfacing from a mask (power3.out) and lifting away
 *              while dissolving (power2.in).
 *  Ambient   — handled by the engine clock (tide hand, breathing).
 */
const REVEAL = 'power3.out'
const EXIT = 'power2.in'

let scrollTrigger: ScrollTrigger | null = null

export function buildIntro(root: HTMLElement, reduced: boolean) {
  const q = gsap.utils.selector(root)
  // built paused at load; it plays once the visitor descends through the threshold
  const tl = gsap.timeline({ paused: true, delay: reduced ? 0 : 0.25 })
  const d = reduced ? 0.01 : 1

  gsap.set(q('.ch1 .line-in'), { yPercent: 112 })
  gsap.set(q('.ch1 [data-fade], .hud'), { autoAlpha: 0, y: 10 })

  tl.to(story, { intro: 1, duration: 3.2 * d, ease: 'sine.inOut' }, 0)
    .to(story, { introMarks: 1, duration: 1.4 * d, ease: 'sine.out' }, 2.3 * d)
    .to(q('.ch1 .line-in'), { yPercent: 0, duration: 1.5 * d, ease: 'expo.out', stagger: 0.14 * d }, 1.0 * d)
    .to(q('.ch1 [data-fade]'), { autoAlpha: 1, y: 0, duration: 1.1 * d, ease: REVEAL, stagger: 0.12 * d }, 1.55 * d)
    .to(q('.hud'), { autoAlpha: 1, y: 0, duration: 1.2 * d, ease: REVEAL, stagger: 0.1 * d }, 2.0 * d)
  return tl
}

export function buildScrollStory(root: HTMLElement, track: HTMLElement, reduced: boolean) {
  const q = gsap.utils.selector(root)

  // hidden starting states for the later chapters
  gsap.set(q('.ch2, .ch3'), { autoAlpha: 0 })
  gsap.set(q('.ch2 .line-in, .ch3 .line-in'), { yPercent: 112 })
  gsap.set(q('.ch2 [data-fade], .ch3 [data-fade]'), { autoAlpha: 0, y: 14 })

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: track,
      start: 'top top',
      end: 'bottom bottom',
      scrub: reduced ? true : 1.1,
    },
  })
  tl.eventCallback('onUpdate', () => {
    story.time = tl.time()
  })
  scrollTrigger = tl.scrollTrigger ?? null

  const surface = (sel: string, at: number, span = 0.7) => {
    tl.fromTo(q(`${sel} .line-in`), { yPercent: 112 }, { yPercent: 0, duration: span, ease: REVEAL, stagger: 0.09, immediateRender: false }, at)
    tl.fromTo(q(`${sel} [data-fade]`), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: span * 0.8, ease: REVEAL, stagger: 0.08, immediateRender: false }, at + 0.18)
  }
  // exits act on wrappers ([data-exit], .mask) so they never fight the reveals
  const lift = (sel: string, at: number, span = 0.5) => {
    tl.to(q(`${sel} .mask, ${sel} [data-exit]`), { yPercent: -28, autoAlpha: 0, duration: span, ease: EXIT, stagger: 0.05 }, at)
  }

  // A chapter's layer is only present while it is on screen, so nothing
  // waiting below a mask (glyphs, text-shadow) can bleed into another chapter.
  const present = (sel: string, from: number, to: number) => {
    tl.set(q(sel), { autoAlpha: 1 }, from)
    tl.set(q(sel), { autoAlpha: 0 }, to)
  }
  present('.ch2', 2.4, 6.0)
  tl.set(q('.ch1'), { autoAlpha: 0 }, 1.0)
  tl.set(q('.ch3'), { autoAlpha: 1 }, 7.3)

  // ── 01 DESCENT → the water rises, the contours unbend
  lift('.ch1', 0.3, 0.6)
  tl.to(story, { unroll: 1, duration: 1.7 }, 0.45)
  tl.to(story, { water: 1, duration: 1.55 }, 0.7)
  tl.to(story, { spread: 1, duration: 1.2 }, 1.7)

  // ── 02 MEMORY — records part around the text, disperse, are read
  surface('.ch2', 2.45, 0.8)
  tl.to(story, { island: 1, duration: 0.8, ease: 'sine.inOut' }, 2.45)
  tl.to(story, { disperse: 1, duration: 2.3 }, 3.25)
  tl.to(story, { read: 1, duration: 2.3 }, 3.4)
  lift('.ch2', 5.35, 0.55)
  tl.to(story, { island: 0, duration: 0.6, ease: 'sine.inOut' }, 5.4)

  // ── 02 → 03 — records condense and curl around a new still point
  tl.to(story, { gather: 1, duration: 1.2 }, 5.55)
  tl.to(story, { curl: 1, duration: 1.3 }, 6.15)
  tl.to(story, { warm: 1, duration: 1.0 }, 6.6)

  // ── 03 AWAKENING — climax, then contraction and stillness
  tl.to(story, { bloom: 1, duration: 1.5 }, 7.1)
  surface('.ch3__during', 7.35, 0.6)
  lift('.ch3__during', 8.5, 0.45)
  tl.to(story, { settle: 1, duration: 1.0, ease: 'none' }, 8.6)
  surface('.ch3__final', 9.05, 0.7)
  tl.set({}, {}, TIMELINE.total)

  return tl
}

/** Scroll position (px) for a point on the story timeline. */
function scrollFor(time: number) {
  if (!scrollTrigger) return 0
  const { start, end } = scrollTrigger
  return start + (end - start) * (time / TIMELINE.total)
}

export function scrollToChapter(index: number, reduced: boolean) {
  const target = scrollFor(TIMELINE.chapters[index])
  const dist = Math.abs(window.scrollY - target) / window.innerHeight
  gsap.to(window, {
    scrollTo: { y: target, autoKill: true },
    duration: reduced ? 0 : Math.min(3.4, 1.1 + dist * 0.38),
    ease: 'power2.inOut',
  })
}
