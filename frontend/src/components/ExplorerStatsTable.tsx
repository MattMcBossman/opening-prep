import type { ExplorerResponse } from '../types'

type Props = {
  data: ExplorerResponse | null
  loading: boolean
  error: string | null
  onMoveClick: (san: string) => void
}

function percent(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0
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
          <th>White</th>
          <th>Draw</th>
          <th>Black</th>
        </tr>
      </thead>
      <tbody>
        {data.moves.map((move) => (
          <tr key={move.uci} className="explorer-row" onClick={() => onMoveClick(move.san)}>
            <td>{move.san}</td>
            <td>{move.totalGames.toLocaleString()}</td>
            <td>{percent(move.white, move.totalGames)}%</td>
            <td>{percent(move.draws, move.totalGames)}%</td>
            <td>{percent(move.black, move.totalGames)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
