import type { ExplorerMoveStat, ExplorerResponse } from '../types'

type Props = {
  data: ExplorerResponse | null
  loading: boolean
  error: string | null
  onMoveClick: (san: string) => void
}

function percent(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0
}

// Below this many total games, percentages are too noisy to be meaningful, so the
// bar labels switch to showing the raw game count for each result instead.
const RAW_COUNT_THRESHOLD = 100
// Segments narrower than this (in %) hide their label entirely rather than clip/overflow.
const MIN_LABEL_PCT = 8

/** A single bar spanning 100%, split into white/draw/black segments sized by their share of results. */
function ResultBar({ move }: { move: ExplorerMoveStat }) {
  const whitePct = percent(move.white, move.totalGames)
  const drawPct = percent(move.draws, move.totalGames)
  const blackPct = percent(move.black, move.totalGames)
  const title = `White ${whitePct.toFixed(1)}% (${move.white}) \u00b7 Draw ${drawPct.toFixed(1)}% (${move.draws}) \u00b7 Black ${blackPct.toFixed(1)}% (${move.black})`

  const useCounts = move.totalGames <= RAW_COUNT_THRESHOLD
  const whiteLabel = useCounts ? move.white.toLocaleString() : `${Math.round(whitePct)}%`
  const drawLabel = useCounts ? move.draws.toLocaleString() : `${Math.round(drawPct)}%`
  const blackLabel = useCounts ? move.black.toLocaleString() : `${Math.round(blackPct)}%`

  return (
    <div className="result-bar" title={title}>
      <span className="result-bar-white" style={{ width: `${whitePct}%` }}>
        {whitePct >= MIN_LABEL_PCT && <span className="result-bar-label">{whiteLabel}</span>}
      </span>
      <span className="result-bar-draw" style={{ width: `${drawPct}%` }}>
        {drawPct >= MIN_LABEL_PCT && <span className="result-bar-label">{drawLabel}</span>}
      </span>
      <span className="result-bar-black" style={{ width: `${blackPct}%` }}>
        {blackPct >= MIN_LABEL_PCT && <span className="result-bar-label">{blackLabel}</span>}
      </span>
    </div>
  )
}

export function ExplorerStatsTable({ data, loading, error, onMoveClick }: Props) {
  if (loading && !data) return <p className="panel-status">Loading explorer stats…</p>
  if (error) return <p className="panel-status error">{error}</p>
  if (!data || data.moves.length === 0) {
    return <p className="panel-status">No Lichess game data for this position.</p>
  }

  return (
    <table className="explorer-table">
      <thead>
        <tr>
          <th>Move</th>
          <th>Games</th>
          <th>Result (W / D / B)</th>
        </tr>
      </thead>
      <tbody>
        {data.moves.map((move) => (
          <tr key={move.uci} className="explorer-row" onClick={() => onMoveClick(move.san)}>
            <td>{move.san}</td>
            <td>
              {move.totalGames.toLocaleString()}
              <span className="explorer-games-pct">
                {' '}
                ({Math.round(percent(move.totalGames, data.totalGames))}%)
              </span>
            </td>
            <td>
              <ResultBar move={move} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
