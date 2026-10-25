import type { ReactNode, Ref } from 'react'
import { Mark } from './Mark'
import { pointer } from '../engine/pointer'

/** A display line that surfaces from its own mask. */
function Line({ children }: { children: ReactNode }) {
  return (
    <span className="mask">
      <span className="line-in">{children}</span>
    </span>
  )
}

export function Descent() {
  return (
    <section className="chapter ch1" aria-labelledby="ch1-title">
      <div className="ch1__intro" data-exit>
        <p className="body-copy" data-fade>
          Tidal Archive is a speculative programme that treats the sea as a recording medium. Begin at the still
          point, where the tide turns but never moves.
        </p>
      </div>

      <div className="ch1__head">
        <div data-exit>
          <p className="label" data-fade>
            <span className="label__num">Chapter 01</span>
            <span className="label__rule" />
            <span>Descent</span>
          </p>
        </div>
        <h1 className="display display--1" id="ch1-title">
          <Line>Beyond</Line>
          <Line>
            <em>the</em> Surface
          </Line>
        </h1>
        <div data-exit>
          <p className="lede" data-fade>
            Every wave carries a memory.
          </p>
        </div>
      </div>
    </section>
  )
}

export function Memory({ islandRef, records }: { islandRef: Ref<HTMLDivElement>; records: number }) {
  return (
    <section className="chapter ch2" aria-labelledby="ch2-title">
      <div className="ch2__island" ref={islandRef}>
        <p className="label" data-fade data-exit>
          <span className="label__num">Chapter 02</span>
          <span className="label__rule" />
          <span>Memory</span>
        </p>
        <h2 className="display display--2" id="ch2-title">
          <Line>Everything</Line>
          <Line>
            leaves <em>an</em>
          </Line>
          <Line>echo</Line>
        </h2>
        <div className="ch2__text">
          <p className="body-copy" data-fade data-exit>
            A tide is a slow sentence, written twice a day. Beneath it the archive keeps every syllable — the weight
            of a storm, the hum of a hull, a song that no one else answered.
          </p>
          <p className="caption" data-fade data-exit>
            Fig. 2 — Records TR—01 to TR—{records}, read at 1 : 12 000
          </p>
        </div>
      </div>
    </section>
  )
}

interface AwakeningProps {
  onAgain: () => void
  onEcho: () => void
  onCancelEcho: () => void
  onForget: () => void
  echoMode: 'off' | 'ready' | 'drawing'
  hasEcho: boolean
}

export function Awakening({ onAgain, onEcho, onCancelEcho, onForget, echoMode, hasEcho }: AwakeningProps) {
  const draw = pointer.fine ? 'Press and draw' : 'Touch and draw'
  return (
    <section className="chapter ch3" aria-labelledby="ch3-title">
      <div className="ch3__during">
        <p className="label" data-fade data-exit>
          <span className="label__num">Chapter 03</span>
          <span className="label__rule" />
          <span>Awakening</span>
        </p>
        <p className="lede ch3__statement">
          <Line>At the still point every trace converges</Line>
          <Line>
            <em>— and the water begins to speak.</em>
          </Line>
        </p>
      </div>

      <div className="ch3__final">
        <h2 className="display display--3" id="ch3-title">
          <Line>
            <em>The</em> Ocean Remembers
          </Line>
        </h2>
        <p className="body-copy ch3__body" data-fade>
          Nothing returns to the sea unchanged, and nothing is lost to it.
        </p>
        <div className="ch3__actions" data-fade>
          {echoMode === 'off' ? (
            <>
              <button type="button" className="line-button" onClick={onAgain}>
                <Mark size={20} className="line-button__mark" />
                Explore again
              </button>
              <button type="button" className="line-button line-button--echo" onClick={onEcho}>
                <svg className="line-button__wave" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
                  <path d="M0 5 Q2.75 0 5.5 5 T11 5 T16.5 5 T22 5" />
                </svg>
                {hasEcho ? 'Leave a new echo' : 'Leave an echo'}
              </button>
            </>
          ) : (
            <p className="echo-hint" aria-live="polite">
              <span className="listen__dot" />
              {echoMode === 'ready' ? `${draw} one slow line — release to keep it` : 'Drawing… release to keep it'}
              <button type="button" className="quiet-button" onClick={onCancelEcho}>
                Cancel
              </button>
            </p>
          )}
        </div>
        <p className="colophon" data-fade>
          Tidal Archive · A fictional programme · Vol. 07 · MMXXVI
          {hasEcho && (
            <button type="button" className="forget" onClick={onForget}>
              Forget my echo
            </button>
          )}
        </p>
      </div>
    </section>
  )
}
