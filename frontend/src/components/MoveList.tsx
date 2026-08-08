import type { HistoryEntry } from '../hooks/useGame'

type MoveRow = {
  moveNumber: number
  white?: HistoryEntry
  whiteIndex?: number
  black?: HistoryEntry
  blackIndex?: number
}

type Props = {
  moves: HistoryEntry[]
  pointer: number
  onSelect: (index: number) => void
}

export function MoveList({ moves, pointer, onSelect }: Props) {
  const rows: MoveRow[] = []
  moves.forEach((entry, i) => {
    if (i % 2 === 0) {
      rows.push({ moveNumber: Math.floor(i / 2) + 1, white: entry, whiteIndex: i + 1 })
    } else {
      rows[rows.length - 1].black = entry
      rows[rows.length - 1].blackIndex = i + 1
    }
  })

  return (
    <div className="move-list">
      <button
        type="button"
        className={pointer === 0 ? 'move-button active' : 'move-button'}
        onClick={() => onSelect(0)}
      >
        Start
      </button>
      {rows.map((row) => (
        <div className="move-row" key={row.moveNumber}>
          <span className="move-number">{row.moveNumber}.</span>
          {row.white && (
            <button
              type="button"
              className={pointer === row.whiteIndex ? 'move-button active' : 'move-button'}
              onClick={() => onSelect(row.whiteIndex!)}
            >
              {row.white.san}
            </button>
          )}
          {row.black && (
            <button
              type="button"
              className={pointer === row.blackIndex ? 'move-button active' : 'move-button'}
              onClick={() => onSelect(row.blackIndex!)}
            >
              {row.black.san}
            </button>
          )}
        </div>
      ))}
      {moves.length === 0 && <p className="panel-status">Play a move or click a row below to begin.</p>}
    </div>
  )
}
