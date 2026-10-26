import { useCallback, useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Engine } from './engine/Engine'
import { Hud } from './components/Hud'
import { Threshold } from './components/Threshold'
import { Awakening, Descent, Memory } from './components/Chapters'
import { buildIntro, buildScrollStory, scrollToChapter } from './story/timeline'
import { story } from './engine/story'
import { listen } from './engine/listen'
import { SoundEngine } from './audio/SoundEngine'
import { echoGesture, forgetEcho, loadEcho } from './engine/echo'
import { WHALE_ACTS, type WhaleAct } from './engine/Whale'
import { WhaleLab } from './components/WhaleLab'

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Hidden test entry for the chapter-01 whale: ?whale=<act> | all | random | lab. Not linked anywhere. */
const whaleParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('whale') : null

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLCanvasElement>(null)
  const depthRef = useRef<HTMLSpanElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const islandRef = useRef<HTMLDivElement>(null)
  const soundWaveRef = useRef<SVGPolylineElement>(null)
  const captionRef = useRef<HTMLDivElement>(null)
  const captionIdRef = useRef<HTMLSpanElement>(null)
  const captionNoteRef = useRef<HTMLSpanElement>(null)
  const captionMemoryRef = useRef<HTMLParagraphElement>(null)
  const subtitleRef = useRef<HTMLParagraphElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const introRef = useRef<gsap.core.Timeline | null>(null)
  const enteredRef = useRef(false)
  const [sound] = useState(() => new SoundEngine())
  const [chapter, setChapter] = useState(0)
  const [entered, setEntered] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [echoMode, setEchoMode] = useState<typeof echoGesture.mode>('off')
  const [hasEcho, setHasEcho] = useState(false)

  useEffect(() => {
    const root = rootRef.current!
    // every visit begins at the surface
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    const engine = new Engine({
      stage: stageRef.current!,
      cursor: cursorRef.current,
      reduced,
      sound,
      hud: { depth: depthRef.current, marker: markerRef.current, soundWave: soundWaveRef.current },
      caption: {
        root: captionRef.current,
        id: captionIdRef.current,
        note: captionNoteRef.current,
        memory: captionMemoryRef.current,
      },
      onChapter: setChapter,
      getIsland: () => islandRef.current?.getBoundingClientRect() ?? null,
      getTitle: () => root.querySelector<HTMLElement>('#ch1-title'),
      getWhaleText: () => ({
        intro: root.querySelector('.ch1__intro .body-copy')?.getBoundingClientRect() ?? null,
        head: root.querySelector('.ch1__head')?.getBoundingClientRect() ?? null,
      }),
      canListen: () => enteredRef.current,
      onEchoMode: setEchoMode,
      onEchoKept: () => setHasEcho(true),
    })
    engineRef.current = engine
    if (whaleParam && whaleParam !== 'lab') {
      const what = whaleParam === 'all' || whaleParam === 'random' ? whaleParam : (whaleParam as WhaleAct)
      if (what === 'all' || what === 'random' || WHALE_ACTS.includes(what)) engine.whale.request(what)
    }

    // an echo left on an earlier visit is the newest stratum of the drawing
    const saved = loadEcho()
    if (saved) {
      engine.setEcho(saved)
      sound.setEcho(saved.wave)
      sound.returning = true
      setHasEcho(true)
    }

    // the narrator's words, as subtitles
    sound.onSubtitle = (text) => {
      const el = subtitleRef.current
      if (!el) return
      if (text) el.textContent = text
      el.classList.toggle('is-on', !!text)
    }

    let cancelled = false
    const ctx = gsap.context(() => {}, root)
    // Text metrics (and the canvas labels) depend on the web fonts.
    document.fonts.ready.then(() => {
      if (cancelled) return
      ctx.add(() => {
        buildScrollStory(root, trackRef.current!, reduced)
        introRef.current = buildIntro(root, reduced)
      })
      if (enteredRef.current) introRef.current?.play()
      engine.measureIsland()
      ScrollTrigger.refresh()
      root.classList.add('is-ready')
    })

    if (import.meta.env.DEV) {
      // Inspection hook for visual QA: drive the ticker by hand when the page is throttled.
      ;(window as unknown as { __tidal: unknown }).__tidal = { gsap, ScrollTrigger, story, engine, sound, listen, whale: engine.whale }
    }

    return () => {
      cancelled = true
      ctx.revert()
      engine.destroy()
      engineRef.current = null
      sound.onSubtitle = null
      sound.destroy()
    }
  }, [sound])

  const enter = useCallback(
    (withSound: boolean) => {
      if (enteredRef.current) return
      enteredRef.current = true
      // this click is the gesture that lets the browser start audio — either way,
      // so hold-to-listen can sound later even after choosing silence
      sound.init()
      sound.setEnabled(withSound)
      setSoundOn(withSound)
      document.documentElement.classList.remove('is-locked')
      ScrollTrigger.refresh()
      gsap.to('.threshold [data-th]', {
        y: -18,
        autoAlpha: 0,
        duration: reduced ? 0.01 : 0.75,
        ease: 'power2.in',
        stagger: reduced ? 0 : 0.05,
        onComplete: () => setEntered(true),
      })
      introRef.current?.play()
    },
    [sound],
  )

  const toggleSound = useCallback(() => {
    const next = !sound.enabled
    sound.setEnabled(next)
    setSoundOn(next)
  }, [sound])

  const leaveEcho = useCallback(() => engineRef.current?.beginEcho(), [])
  const cancelEcho = useCallback(() => engineRef.current?.cancelEcho(), [])
  const forget = useCallback(() => {
    forgetEcho()
    engineRef.current?.setEcho(null)
    sound.setEcho(null)
    sound.returning = false
    setHasEcho(false)
  }, [sound])

  const getWhale = useCallback(() => engineRef.current?.whale ?? null, [])
  const navigate = useCallback((i: number) => scrollToChapter(i, reduced), [])
  const again = useCallback(() => scrollToChapter(0, reduced), [])

  return (
    <div className="app" ref={rootRef}>
      <canvas className="stage" ref={stageRef} aria-hidden="true" />

      <main className="scenes">
        <Descent />
        <Memory islandRef={islandRef} records={hasEcho ? 31 : 30} />
        <Awakening
          onAgain={again}
          onEcho={leaveEcho}
          onCancelEcho={cancelEcho}
          onForget={forget}
          echoMode={echoMode}
          hasEcho={hasEcho}
        />
      </main>

      <Hud
        chapter={chapter}
        onNavigate={navigate}
        depthRef={depthRef}
        markerRef={markerRef}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        soundWaveRef={soundWaveRef}
      />

      {/* What a held record is: its number, its note and the memory it keeps. */}
      <div className="listen" ref={captionRef} aria-live="polite">
        <p className="listen__meta">
          <span className="listen__dot" />
          <span ref={captionIdRef} />
          <span className="listen__note" ref={captionNoteRef} />
        </p>
        <p className="listen__memory" ref={captionMemoryRef} />
      </div>

      {/* The narrator's words. */}
      <p className="subtitle" ref={subtitleRef} aria-live="polite" />

      {/* The scroll track: its length is the film's running time. */}
      <div className="track" ref={trackRef} aria-hidden="true" />

      {!entered && <Threshold onEnter={enter} />}

      {whaleParam === 'lab' && <WhaleLab getWhale={getWhale} />}

      <canvas className="cursor" ref={cursorRef} aria-hidden="true" />
    </div>
  )
}
