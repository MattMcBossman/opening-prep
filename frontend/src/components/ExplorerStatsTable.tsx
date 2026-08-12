import { formatCompactNumber } from '../lib/formatNumber'
import type { ExplorerMoveStat, ExplorerResponse } from '../types'

type Props = {
  data: ExplorerResponse | null
  loading: boolean
  error: string | null
  /**
   * Plays the clicked move. Omit to render the table read-only - used by the
   * drill review panel, where the board is paused at a finished line and
   * shouldn't be moved on.
   */
  onMoveClick?: (san: string) => void
  /** Whether the given move (by UCI) is already saved in the active repertoire at the current position. */
  isMoveSaved: (uci: string) => boolean
  /** Whether it's the repertoire owner's own turn at the current position (vs. the opponent's). */
  isMyMove: boolean
  /** True only while indexing snapshots are visibly changing; silent polling may continue after they stabilize. */
  isPolling?: boolean
  /** True once automatic re-polling has given up while still indexing - shows a manual "Try again" button. */
  pollExhausted?: boolean
  /** Restarts polling - only used/shown when `pollExhausted`. */
  onRetry?: () => void
  /** Google sign-in or Lichess-link destination for account-required states. */
  accountActionHref?: string
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
  const whiteLabel = useCounts ? formatCompactNumber(move.white) : `${Math.round(whitePct)}%`
  const drawLabel = useCounts ? formatCompactNumber(move.draws) : `${Math.round(drawPct)}%`
  const blackLabel = useCounts ? formatCompactNumber(move.black) : `${Math.round(blackPct)}%`

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

function GamesFoundNote({
  data,
  isPolling,
  pollExhausted,
  onRetry,
}: Pick<Props, 'data' | 'isPolling' | 'pollExhausted' | 'onRetry'>) {
  const visiblyUpdating = Boolean(data?.stillIndexing && isPolling)
  const message = `Found ${formatCompactNumber(data?.totalGames ?? 0)} games`
  return (
    <p className="panel-status" aria-label={`${message}${visiblyUpdating ? ', checking for more.' : '.'}`}>
      {message}
      {visiblyUpdating ? (
        <span className="loading-ellipsis" aria-hidden="true">
          <span>.</span><span>.</span><span>.</span>
        </span>
      ) : '.'}
      {pollExhausted && onRetry && (
        <>
          {' '}
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </p>
  )
}

export function ExplorerStatsTable({
  data,
  loading,
  error,
  onMoveClick,
  isMoveSaved,
  isMyMove,
  isPolling,
  pollExhausted,
  onRetry,
  accountActionHref,
}: Props) {
  if (loading && !data) return <p className="panel-status">Loading explorer stats…</p>
  if (error && accountActionHref) {
    if (error === 'Sign in and link a Lichess account to load explorer data.') {
      return <p className="panel-status error"><a href={accountActionHref}>Sign in</a> and link a Lichess account to load explorer data.</p>
    }
    if (error === 'Sign in to link a Lichess or Chess.com account and view your own game history.') {
      return <p className="panel-status error"><a href={accountActionHref}>Sign in</a> to link a Lichess or Chess.com account and view your own game history.</p>
    }
    if (error === 'Sign in with Lichess to load explorer stats.') {
      return <p className="panel-status error"><a href={accountActionHref}>Link your Lichess account</a> to load explorer stats.</p>
    }
    if (
      error === 'Link your Lichess account to see stats from your own games.'
      || error === 'Sign in with Lichess to see stats from your own games.'
    ) {
      return <p className="panel-status error"><a href={accountActionHref}>Link your Lichess account</a> to see stats from your own games.</p>
    }
  }
  if (error) return <p className="panel-status error">{error}</p>
  if (!data || data.moves.length === 0) {
    return (
      <>
        {data && <GamesFoundNote data={data} isPolling={isPolling} pollExhausted={pollExhausted} onRetry={onRetry} />}
        <p className="panel-status">No Lichess game data for this position.</p>
      </>
    )
  }

  return (
    <>
      <GamesFoundNote data={data} isPolling={isPolling} pollExhausted={pollExhausted} onRetry={onRetry} />
      <table className="explorer-table">
        <thead>
          <tr>
            <th>Move</th>
            <th>Games</th>
            <th>Result (W / D / B)</th>
          </tr>
        </thead>
        <tbody>
          {data.moves.map((move) => {
            const saved = isMoveSaved(move.uci)
            const classNames = ['explorer-row']
            if (!onMoveClick) classNames.push('explorer-row-static')
            if (saved) classNames.push('explorer-row-saved')
            return (
              <tr
                key={move.uci}
                className={classNames.join(' ')}
                onClick={onMoveClick ? () => onMoveClick(move.san) : undefined}
              >
                <td data-label="Move">
                  {move.san}
                  {saved && (
                    <span className="explorer-saved-badge" title="In your prep" aria-label="In your prep">
                      {isMyMove ? '\u2605' : '\u2713'}
                    </span>
                  )}
                </td>
                <td data-label="Games" className="explorer-games-cell">
                  {formatCompactNumber(move.totalGames)}
                  <span className="explorer-games-pct">
                    {' '}
                    ({Math.round(percent(move.totalGames, data.totalGames))}%)
                  </span>
                </td>
                <td data-label="Results">
                  <ResultBar move={move} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
