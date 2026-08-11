import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../lib/apiClient'
import { fetchCachedEngineEvaluation, getRememberedEngineEvaluation } from '../lib/engineEvaluationCache'
import { fetchExplorerStats } from '../lib/lichessExplorer'
import type { LichessDatabaseFilters } from '../lib/lichessExplorer'
import { aggregatePositionCoverage, calculatePositionCoverage, coverageGapImpact, FULLY_COVERED_TARGET_PERCENT, opponentPositions, rankCoverageGaps } from '../lib/repertoireCoverage'
import type { PositionCoverage } from '../lib/repertoireCoverage'
import type { RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

type Props = {
  color: RepertoireColor
  tree: RepertoireTree
  apiToken: string
  signedIn: boolean
  filters?: LichessDatabaseFilters
  getContinuations: (fen: string) => RepertoireMove[]
  onOpenPosition: (fen: string) => void
}

function completeFen(fen: string): string {
  return fen.split(' ').length >= 6 ? fen : `${fen} 0 1`
}

const REQUEST_INTERVAL_MS = 1100
const MAX_RATE_LIMIT_RETRIES = 3

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function evaluationLabel(score: NonNullable<PositionCoverage['evaluation']>, color: RepertoireColor): string {
  const repertoireScore = score.scoreValue * (color === 'white' ? 1 : -1)
  if (score.scoreType === 'mate') return repertoireScore > 0 ? 'forced mate for repertoire' : 'forced mate against repertoire'
  if (Math.abs(repertoireScore) < 15) return 'roughly equal'
  return `${repertoireScore > 0 ? '+' : ''}${(repertoireScore / 100).toFixed(1)} for repertoire`
}

export function CoverageDashboard({ color, tree, apiToken, signedIn, filters, getContinuations, onOpenPosition }: Props) {
  const positions = useMemo(() => opponentPositions(tree, color), [color, tree])
  const [requested, setRequested] = useState(false)
  const [runId, setRunId] = useState(0)
  const [scores, setScores] = useState<PositionCoverage[]>([])
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rateLimitWait, setRateLimitWait] = useState<number | null>(null)

  useEffect(() => {
    setRequested(false)
    setScores([])
    setProgress(0)
    setError(null)
    setRateLimitWait(null)
  }, [color, tree, filters])

  useEffect(() => {
    if (!requested) return
    const controller = new AbortController()
    const run = async () => {
      const next: PositionCoverage[] = []
      setError(null)
      for (let index = 0; index < positions.length; index += 1) {
        const fen = positions[index]
        try {
          let stats
          for (let attempt = 0; ; attempt += 1) {
            try {
              stats = await fetchExplorerStats(completeFen(fen), {
                apiToken,
                signedIn,
                signal: controller.signal,
                filters,
              })
              setRateLimitWait(null)
              break
            } catch (reason) {
              if (!(reason instanceof ApiError) || reason.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) throw reason
              const seconds = Math.max(1, reason.retryAfterSeconds ?? 5 * (attempt + 1))
              for (let remaining = seconds; remaining > 0; remaining -= 1) {
                setRateLimitWait(remaining)
                await wait(1000, controller.signal)
              }
            }
          }
          next.push({
            ...calculatePositionCoverage(stats.moves, getContinuations(fen), getContinuations),
            fen,
            openingName: stats.opening?.name,
            evaluation: getRememberedEngineEvaluation(completeFen(fen))
              ?? (signedIn ? await fetchCachedEngineEvaluation(completeFen(fen)).catch(() => null) : null),
          })
          setScores([...next])
          setProgress(index + 1)
          if (index + 1 < positions.length) await wait(REQUEST_INTERVAL_MS, controller.signal)
        } catch (reason) {
          if (controller.signal.aborted) return
          setError(reason instanceof Error ? reason.message : 'Coverage could not be calculated.')
          return
        }
      }
    }
    void run()
    return () => controller.abort()
  }, [apiToken, filters, getContinuations, positions, requested, runId, signedIn])

  const summary = aggregatePositionCoverage(scores)
  const gaps = rankCoverageGaps(scores, color)
  const loading = requested && progress < positions.length && !error
  return <section className="coverage-dashboard">
    <h3>{color === 'white' ? 'White' : 'Black'} coverage</h3>
    {!requested ? <>
      <p className="panel-status">{positions.length} prepared opponent position{positions.length === 1 ? '' : 's'} to score.</p>
      <button type="button" disabled={positions.length === 0 || (!signedIn && !apiToken)} onClick={() => setRequested(true)}>Calculate coverage</button>
    </> : <>
      <p className="coverage-score"><strong>{summary.percent.toFixed(1)}%</strong> frequency-weighted coverage</p>
      <p className="panel-status">
        {summary.coveredPositions} fully covered (at least {FULLY_COVERED_TARGET_PERCENT}%),{' '}
        {summary.partiallyCoveredPositions} partially covered, {summary.noDataPositions} with no data.
      </p>
      {gaps.length > 0 && <div className="coverage-gaps">
        <h4>Highest-impact gaps</h4>
        <ol>
          {gaps.slice(0, 5).map((gap, index) => {
            const uncoveredGames = gap.totalGames - gap.coveredGames
            return <li key={gap.fen ?? index}>
              <button type="button" onClick={() => gap.fen && onOpenPosition(completeFen(gap.fen))} disabled={!gap.fen}>
                <span>{gap.openingName ?? `Position ${index + 1}`}</span>
                <strong>{uncoveredGames.toLocaleString()} uncovered games</strong>
                <small>
                  Priority {Math.round(coverageGapImpact(gap, color)).toLocaleString()} ·{' '}
                  {gap.evaluation ? evaluationLabel(gap.evaluation, color) : 'no cached evaluation'}
                </small>
                <small>{gap.percent.toFixed(1)}% covered · {gap.totalGames.toLocaleString()} sampled</small>
              </button>
            </li>
          })}
        </ol>
      </div>}
      {loading && <p className="panel-status">Scoring position {progress + 1} of {positions.length}…</p>}
      {rateLimitWait !== null && <p className="panel-status">Lichess asked us to slow down. Resuming in {rateLimitWait}s…</p>}
      {error && <p className="panel-status error">{error}</p>}
      {!loading && <button type="button" onClick={() => { setScores([]); setProgress(0); setError(null); setRunId((value) => value + 1) }}>Recalculate</button>}
    </>}
  </section>
}
