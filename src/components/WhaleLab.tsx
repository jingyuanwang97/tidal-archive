import { useEffect, useState } from 'react'
import { WHALE_ACTS, type WhaleAct, type WhaleStatus, type WhaleWatch } from '../engine/Whale'

/**
 * A testing panel for the hidden whale, shown only with ?whale=lab.
 * Each act plays as soon as chapter 01 is at rest.
 */
export function WhaleLab({ getWhale }: { getWhale: () => WhaleWatch | null }) {
  const [status, setStatus] = useState<WhaleStatus | null>(null)

  useEffect(() => {
    const id = setInterval(() => setStatus(getWhale()?.status() ?? null), 250)
    return () => clearInterval(id)
  }, [getWhale])

  const play = (what: WhaleAct | 'all' | 'random') => getWhale()?.request(what)

  return (
    <aside className="whale-lab" aria-label="Whale test panel" data-no-listen>
      <p className="whale-lab__title">Whale lab</p>
      <div className="whale-lab__acts">
        {WHALE_ACTS.map((a) => (
          <button key={a} type="button" onClick={() => play(a)}>
            {a}
          </button>
        ))}
        <button type="button" onClick={() => play('all')}>
          all five
        </button>
        <button type="button" onClick={() => play('random')}>
          random
        </button>
      </div>
      {status && (
        <p className="whale-lab__status">
          {status.playing ? `playing ${status.playing} · ${status.t.toFixed(1)} s` : `waiting ${status.dwell.toFixed(0)} / ${status.nextAt.toFixed(0)} s`}
          {status.queued > 0 && ` · ${status.queued} queued`}
        </p>
      )}
      <p className="whale-lab__note">Plays at the top of chapter 01, after the intro.</p>
    </aside>
  )
}
