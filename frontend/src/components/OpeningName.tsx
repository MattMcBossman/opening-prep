import { useRef } from 'react'
import { START_FEN } from '../hooks/useGame'

type Props = {
  name: string | null
  fen: string
  loading?: boolean
}

/** Shows the preferred human name while hiding internal classification codes. */
export function OpeningName({ name, fen, loading = false }: Props) {
  const lastSettledName = useRef<string | null>(name)
  if (!loading) lastSettledName.current = name
  const displayedName = loading ? lastSettledName.current : name

  // The starting position has no opening of its own; showing an unavailable-name fallback there
  // is just noise, so render an (empty, height-reserving) placeholder instead.
  if (!displayedName && fen === START_FEN) {
    return <div className="opening-name" />
  }

  return (
    <div className="opening-name">
      {displayedName ? (
        <span className="opening-name-text">{displayedName}</span>
      ) : loading ? (
        <span className="opening-name-text opening-name-empty">Loading opening…</span>
      ) : (
        <span className="opening-name-text opening-name-empty">Unclassified position</span>
      )}
    </div>
  )
}
