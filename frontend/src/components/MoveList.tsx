import { useEffect, useRef } from 'react'
import type { HistoryEntry } from '../hooks/useGame'
import type { RepertoireColor, RepertoireMove } from '../types'

type Cell =
  | { kind: 'played'; entry: HistoryEntry; index: number }
  | { kind: 'continuation'; move: RepertoireMove }

type Row = {
  moveNumber: number
  white?: Cell
  black?: Cell
}

type Props = {
  moves: HistoryEntry[]
  pointer: number
  onSelect: (index: number) => void
  /** Which repertoire (White's or Black's own moves) is currently active. */
  boardColor: RepertoireColor
  /** Whether the ply at `moves[index]` (0-based) is saved in the active repertoire. */
  isPlySaved: (index: number) => boolean
  /** Toggles whether the ply at `moves[index]` (0-based) is saved in the active repertoire. */
  onTogglePlySaved: (index: number) => void
  /** Saved moves from the current position (tracks `pointer`), rendered right after the played moves. */
  continuations: RepertoireMove[]
  /** Plays a saved continuation, extending the line. */
  onPlayContinuation: (move: RepertoireMove) => void
  /** Removes a saved continuation without playing it. */
  onRemoveContinuation: (move: RepertoireMove) => void
  /** Whether a merged-profile continuation belongs to the module currently being edited. */
  isContinuationEditable?: (move: RepertoireMove) => boolean
}

function StarButton({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={saved ? 'move-star active' : 'move-star'}
      title={saved ? 'Remove from repertoire' : 'Save to repertoire'}
      aria-label={saved ? 'Remove from repertoire' : 'Save to repertoire'}
      onClick={onToggle}
    >
      {saved ? '\u2605' : '\u2606'}
    </button>
  )
}

/** Rows for the moves actually played so far (up to `pointer`). */
function buildPlayedRows(moves: HistoryEntry[], pointer: number): Row[] {
  const played = moves.slice(0, pointer)
  const rows: Row[] = []
  played.forEach((entry, i) => {
    const cell: Cell = { kind: 'played', entry, index: i }
    if (i % 2 === 0) {
      rows.push({ moveNumber: Math.floor(i / 2) + 1, white: cell })
    } else {
      rows[rows.length - 1].black = cell
    }
  })
  return rows
}

/**
 * Rows for whatever the repertoire has saved from the position at `pointer`, each on
 * its own row - never sharing a row with an already-played move, even when a
 * continuation would otherwise fill that row's empty cell, so continuations always
 * read as a distinct "available next steps" group below the played line.
 */
function buildContinuationRows(pointer: number, continuations: RepertoireMove[]): Row[] {
  const nextIsWhite = pointer % 2 === 0
  const moveNumber = nextIsWhite ? Math.floor(pointer / 2) + 1 : Math.floor((pointer - 1) / 2) + 1
  return continuations.map((move) => {
    const cell: Cell = { kind: 'continuation', move }
    return nextIsWhite ? { moveNumber, white: cell } : { moveNumber, black: cell }
  })
}

type CellButtonProps = {
  cell: Cell | undefined
  pointer: number
  onSelect: (index: number) => void
  onPlayContinuation: (move: RepertoireMove) => void
}

function CellButton({ cell, pointer, onSelect, onPlayContinuation }: CellButtonProps) {
  if (!cell) return <span />
  if (cell.kind === 'played') {
    const active = pointer === cell.index + 1
    return (
      <button type="button" className={active ? 'move-button active' : 'move-button'} onClick={() => onSelect(cell.index + 1)}>
        {cell.entry.san}
      </button>
    )
  }
  return (
    <button type="button" className="move-button move-button-suggestion" onClick={() => onPlayContinuation(cell.move)}>
      {cell.move.san}
    </button>
  )
}

/**
 * Only the repertoire owner's own moves can be saved (see AGENTS.md) - the opponent's
 * replies are never saved on their own, they're just the positions that trigger a
 * saved response. So each row gets a single star, tied to whichever column holds
 * "my" move: the white column when building the White repertoire, the black column
 * when building the Black repertoire. It applies the same way to a continuation cell
 * (always shown as saved, since continuations are read from what's already saved;
 * clicking removes it) as to an already-played move (toggles save/unsave).
 */
export function MoveList({
  moves,
  pointer,
  onSelect,
  boardColor,
  isPlySaved,
  onTogglePlySaved,
  continuations,
  onPlayContinuation,
  onRemoveContinuation,
  isContinuationEditable = () => true,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const playedRows = buildPlayedRows(moves, pointer)
  const continuationRows = buildContinuationRows(pointer, continuations)
  const continuationKey = continuations.map((move) => move.uci).join(' ')

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = listRef.current
      if (!list) return
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [pointer, continuationKey])

  function renderStar(cell: Cell | undefined) {
    if (!cell) return null
    if (cell.kind === 'played') {
      return <StarButton saved={isPlySaved(cell.index)} onToggle={() => onTogglePlySaved(cell.index)} />
    }
    return isContinuationEditable(cell.move) ? (
      <StarButton saved onToggle={() => onRemoveContinuation(cell.move)} />
    ) : null
  }

  function renderRow(row: Row, key: string) {
    return (
      <div className="move-row" key={key}>
        <span className="move-star-slot">{boardColor === 'white' ? renderStar(row.white) : null}</span>
        <span className="move-number">{row.moveNumber}.</span>
        <CellButton cell={row.white} pointer={pointer} onSelect={onSelect} onPlayContinuation={onPlayContinuation} />
        <CellButton cell={row.black} pointer={pointer} onSelect={onSelect} onPlayContinuation={onPlayContinuation} />
        <span className="move-star-slot">{boardColor === 'black' ? renderStar(row.black) : null}</span>
      </div>
    )
  }

  return (
    <div ref={listRef} className="move-list">
      {playedRows.map((row, i) => renderRow(row, `played-${i}`))}
      {playedRows.length > 0 && continuationRows.length > 0 && <div className="move-list-divider" />}
      {continuationRows.map((row, i) => renderRow(row, `continuation-${i}`))}
      {playedRows.length === 0 && continuationRows.length === 0 && (
        <p className="panel-status">Play a move to begin.</p>
      )}
    </div>
  )
}
