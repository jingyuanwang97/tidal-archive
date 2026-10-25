import type { Ref } from 'react'
import { Mark } from './Mark'
import { TIMELINE } from '../engine/story'
import { pointer } from '../engine/pointer'

const CHAPTERS = ['Descent', 'Memory', 'Awakening']
const HINTS = [
  'Scroll to descend',
  pointer.fine ? 'Click & hold a record to listen' : 'Hold a record to listen',
  'Rest at the still point',
]

interface HudProps {
  chapter: number
  onNavigate: (index: number) => void
  depthRef: Ref<HTMLSpanElement>
  markerRef: Ref<HTMLSpanElement>
  soundOn: boolean
  onToggleSound: () => void
  soundWaveRef: Ref<SVGPolylineElement>
}

export function Hud({ chapter, onNavigate, depthRef, markerRef, soundOn, onToggleSound, soundWaveRef }: HudProps) {
  return (
    <>
      <header className="hud hud--top">
        <button type="button" className="brand" onClick={() => onNavigate(0)} aria-label="Tidal Archive — back to the surface">
          <Mark />
          <span className="brand__name">Tidal Archive</span>
        </button>
        <p className="hud__title">
          <em>The Ocean Remembers</em>
        </p>
        <div className="hud__end">
          <button
            type="button"
            className="sound"
            aria-pressed={soundOn}
            aria-label={soundOn ? 'Sound on — turn off' : 'Sound off — turn on'}
            onClick={onToggleSound}
          >
            <svg className="sound__wave" width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
              <polyline ref={soundWaveRef} points="0,6 26,6" />
            </svg>
            <span className="sound__label">{soundOn ? 'Sound' : 'Muted'}</span>
          </button>
          <nav className="chapters" aria-label="Chapters">
            {CHAPTERS.map((name, i) => (
              <button
                key={name}
                type="button"
                className="chapters__item"
                aria-current={chapter === i ? 'step' : undefined}
                onClick={() => onNavigate(i)}
              >
                <span className="chapters__num">0{i + 1}</span>
                <span className="chapters__name">{name}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <footer className="hud hud--bottom">
        <p className="depth" aria-hidden="true">
          <span className="depth__k">Depth</span>
          <span className="depth__v" ref={depthRef}>
            0000
          </span>
          <span className="depth__u">m</span>
        </p>
        <div className="tape" aria-hidden="true">
          <span className="tape__fill" ref={markerRef} />
          {TIMELINE.chapters.slice(1).map((t) => (
            <span key={t} className="tape__tick" style={{ left: `${(t / TIMELINE.total) * 100}%` }} />
          ))}
        </div>
        <p className="hint" aria-live="polite">
          <span className="hint__rule" />
          {HINTS[chapter]}
        </p>
      </footer>
    </>
  )
}
