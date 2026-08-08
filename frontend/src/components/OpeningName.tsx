import { START_FEN } from '../hooks/useGame'

type Props = {
  eco: string | null
  name: string | null
  fen: string
}

/**
 * MVP opening-name lookup: uses the "opening" field Lichess's explorer API already
 * returns for known positions. See AGENTS.md "ECO/opening-name lookup" for the manual
 * override, which is deferred to the repertoire view (Phase 2).
 */
export function OpeningName({ eco, name, fen }: Props) {
  // The starting position has no opening of its own; showing "Unnamed position" there
  // is just noise, so render an (empty, height-reserving) placeholder instead.
  if (!name && fen === START_FEN) {
    return <div className="opening-name" />
  }

  return (
    <div className="opening-name">
      {name ? (
        <span className="opening-name-text">
          {eco ? `${eco} · ` : ''}
          {name}
        </span>
      ) : (
        <span className="opening-name-text opening-name-empty">Unnamed position</span>
      )}
    </div>
  )
}
