import { pointer } from '../engine/pointer'

/**
 * The threshold before the descent. Choosing is the gesture that lets the
 * browser start sound; either choice also unlocks hold-to-listen.
 */
export function Threshold({ onEnter }: { onEnter: (withSound: boolean) => void }) {
  const hold = pointer.fine ? 'Click and hold' : 'Touch and hold'
  return (
    <div className="threshold" role="dialog" aria-modal="true" aria-labelledby="threshold-title" data-no-listen>
      <div className="threshold__inner">
        <svg className="threshold__mark" data-th width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <ellipse cx="28" cy="29" rx="23" ry="21.6" />
            <ellipse cx="26.2" cy="27.2" rx="14.6" ry="13.6" />
            <ellipse cx="24.8" cy="25.8" rx="6.6" ry="6.1" />
          </g>
          <line className="threshold__hand" x1="24.4" y1="25.4" x2="24.4" y2="3" stroke="var(--accent)" strokeWidth="1" />
          <circle cx="24.4" cy="25.4" r="1.8" fill="var(--accent)" />
        </svg>
        <p className="label threshold__label" data-th>
          <span className="label__num">Vol. 07</span>
          <span className="label__rule" />
          <span>Tidal Archive</span>
        </p>
        <h2 className="threshold__title" id="threshold-title" data-th>
          The sea keeps everything it hears.
        </h2>
        <div className="threshold__actions" data-th>
          <button type="button" className="line-button" onClick={() => onEnter(true)}>
            <svg className="line-button__wave" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
              <path d="M0 5 Q2.75 0 5.5 5 T11 5 T16.5 5 T22 5" />
            </svg>
            Descend with sound
          </button>
          <button type="button" className="quiet-button" onClick={() => onEnter(false)}>
            Descend in silence
          </button>
        </div>
        <p className="caption threshold__note" data-th>
          <span>Best with headphones · Generated live in your browser</span>
          <span>{hold} anything to listen</span>
        </p>
      </div>
    </div>
  )
}
