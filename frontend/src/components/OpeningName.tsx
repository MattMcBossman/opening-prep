import { useEffect, useState } from 'react'

type Props = {
  eco: string | null
  name: string | null
  fen: string
}

/**
 * MVP opening-name lookup: uses the "opening" field Lichess's explorer API already
 * returns for known positions, plus a manual override text input (session-only for
 * now; persisting overrides moves to the Django backend alongside the repertoire in
 * Phase 2). See AGENTS.md "ECO/opening-name lookup".
 */
export function OpeningName({ eco, name, fen }: Props) {
  const [override, setOverride] = useState('')

  // Overrides are per-position; clear the input when the position changes.
  useEffect(() => {
    setOverride('')
  }, [fen])

  const displayName = override || name

  return (
    <div className="opening-name">
      {displayName ? (
        <span className="opening-name-text">
          {eco && !override ? `${eco} · ` : ''}
          {displayName}
        </span>
      ) : (
        <span className="opening-name-text opening-name-empty">Unnamed position</span>
      )}
      <input
        className="opening-name-override"
        placeholder="Override name…"
        value={override}
        onChange={(e) => setOverride(e.target.value)}
      />
    </div>
  )
}
