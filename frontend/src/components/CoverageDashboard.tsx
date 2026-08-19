import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { fetchCoverageSnapshots } from '../lib/repertoireApi'
import { calculateModuleCoveragePartition, calculateRepertoireNodeProbabilities, clusterLeafCoverage, coveragePositionLabel, DEFAULT_LEAF_SCORE_PARAMETERS, leafEvaluationValue, leafPreparationScore, leafQualifiesForCoverage, moduleCoverageScope, opponentPositions } from '../lib/repertoireCoverage'
import type { LeafCoverageCluster, LeafCoveragePoint, LeafScoreParameters, PositionCoverage } from '../lib/repertoireCoverage'
import type { DrillLine } from '../lib/repertoireDrills'
import { canonicalMoveUci, normalizeFen } from '../lib/chessUtils'
import type { RepertoireColor, RepertoireTree } from '../types'

type Props = {
  color: RepertoireColor
  coverageLabel: string
  tree: RepertoireTree
  lines: DrillLine[]
  fullRepertoire?: boolean
  signedIn: boolean
  onOpenPosition: (fen: string, pathUci?: string[]) => void
}

function completeFen(fen: string): string {
  return fen.split(' ').length >= 6 ? fen : `${fen} 0 1`
}

type CoverageTableSort = 'position' | 'depth' | 'evaluation' | 'score' | 'reach' | 'children' | 'unprepared' | 'frequency'
type SortDirection = 'ascending' | 'descending'
type ScoreBand = 'unavailable' | 'far-below' | 'below' | 'meets' | 'strong'
const COVERAGE_CHART_MAX_EVALUATION = 5
const COVERAGE_CHART_MIN_EVALUATION = -1
const COVERAGE_TABLE_PAGE_SIZE = 25
function CoverageTableEvaluation({ score }: { score: NonNullable<PositionCoverage['evaluation']> }) {
  if (score.scoreType === 'cp' && score.scoreValue === 0) return <>0.0</>
  if (score.scoreType === 'mate' && score.scoreValue === 0) return <>M</>
  const whiteAdvantage = score.scoreValue > 0
  const value = score.scoreType === 'mate'
    ? `M${Math.abs(score.scoreValue)}`
    : Math.abs(score.scoreValue / 100).toFixed(1)
  return <span className="coverage-table-eval">
    <span
      className={`coverage-eval-arrow ${whiteAdvantage ? 'white' : 'black'}`}
      role="img"
      aria-label={`${whiteAdvantage ? 'White' : 'Black'} advantage`}
    >{whiteAdvantage ? '↑' : '↓'}</span>
    <span>{value}</span>
  </span>
}

function formatCoveragePercent(value: number): string {
  if (value === 0) return '0.00%'
  return value < 0.01 ? '<0.01%' : `${value.toFixed(2)}%`
}

function PreparedPositionCoverageGraph({ points, color, openingPly, scoreParameters, onOpenPosition }: { points: LeafCoveragePoint[]; color: RepertoireColor; openingPly: number; scoreParameters: LeafScoreParameters; onOpenPosition: (fen: string, pathUci?: string[]) => void }) {
  const [selected, setSelected] = useState<LeafCoverageCluster | null>(null)
  const [sort, setSort] = useState<CoverageTableSort>('frequency')
  const [sortDirection, setSortDirection] = useState<SortDirection>('descending')
  const [page, setPage] = useState(0)
  const clusters = useMemo(() => clusterLeafCoverage(points, color), [color, points])
  const plottedDepths = [...new Set(clusters.map((cluster) => cluster.depth))]
  const pointName = (point: LeafCoveragePoint) => coveragePositionLabel(
    point.moves,
    point.depth === openingPly ? 0 : openingPly,
  )
  const openPoint = (point: LeafCoveragePoint) => onOpenPosition(
    completeFen(point.fen),
    point.id ? point.id.split(' ') : undefined,
  )
  const pointScore = (point: LeafCoveragePoint) => leafPreparationScore(
    point.depth - openingPly, point.evaluation, color, scoreParameters,
  )
  const preparedReplyRate = (point: LeafCoveragePoint) => {
    const reach = point.reachFrequency ?? 0
    return reach > 0 ? ((point.childFrequency ?? 0) / reach) * 100 : 0
  }
  const unpreparedReplyRate = (point: LeafCoveragePoint) => {
    const reach = point.reachFrequency ?? 0
    return reach > 0 ? (point.frequency / reach) * 100 : 0
  }
  const sorted = [...(selected?.points ?? points)].sort((left, right) => {
    let comparison: number
    if (sort === 'position') comparison = pointName(left).localeCompare(pointName(right))
    else {
      const leftValue = sort === 'frequency' ? left.frequency
        : sort === 'reach' ? (left.reachFrequency ?? 0)
          : sort === 'children' ? preparedReplyRate(left)
            : sort === 'unprepared' ? unpreparedReplyRate(left)
            : sort === 'depth' ? left.depth
            : sort === 'score' ? pointScore(left)
              : leafEvaluationValue(left, color)
      const rightValue = sort === 'frequency' ? right.frequency
        : sort === 'reach' ? (right.reachFrequency ?? 0)
          : sort === 'children' ? preparedReplyRate(right)
            : sort === 'unprepared' ? unpreparedReplyRate(right)
            : sort === 'depth' ? right.depth
            : sort === 'score' ? pointScore(right)
              : leafEvaluationValue(right, color)
      if (leftValue === null && rightValue === null) comparison = 0
      else if (leftValue === null) return 1
      else if (rightValue === null) return -1
      else comparison = leftValue === rightValue ? 0 : leftValue - rightValue
    }
    return sortDirection === 'ascending' ? comparison : -comparison
  })
  const changeSort = (next: CoverageTableSort) => {
    setPage(0)
    if (next === sort) setSortDirection((current) => current === 'ascending' ? 'descending' : 'ascending')
    else {
      setSort(next)
      setSortDirection('ascending')
    }
  }
  const sortableHeading = (key: CoverageTableSort, label: string, title?: string) => <th aria-sort={sort === key ? sortDirection : 'none'} title={title}>
    <button type="button" title={title} onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sort === key ? sortDirection === 'ascending' ? ' ↑' : ' ↓' : ''}</span></button>
  </th>
  const chartWidth = Math.max(180, plottedDepths.length * 68 + 68)
  const x = (depth: number) => 68 + plottedDepths.indexOf(depth) * 68
  const y = (evaluation: number) => {
    const bounded = Math.max(COVERAGE_CHART_MIN_EVALUATION, Math.min(COVERAGE_CHART_MAX_EVALUATION, evaluation))
    return 4 + ((COVERAGE_CHART_MAX_EVALUATION - bounded) / (COVERAGE_CHART_MAX_EVALUATION - COVERAGE_CHART_MIN_EVALUATION)) * 92
  }
  const clusterScore = (cluster: LeafCoverageCluster) => {
    const scored = cluster.points.flatMap((point) => {
      const score = pointScore(point)
      return score === null ? [] : [{ score, weight: Math.max(point.frequency, 0.0001) }]
    })
    if (scored.length === 0) return null
    return scored.reduce((sum, item) => sum + item.score * item.weight, 0) / scored.reduce((sum, item) => sum + item.weight, 0)
  }
  const scoreBand = (score: number | null): ScoreBand => {
    if (score === null) return 'unavailable'
    const distance = score - scoreParameters.minimumScore
    if (distance < -8) return 'far-below'
    if (distance < 0) return 'below'
    if (distance < 8) return 'meets'
    return 'strong'
  }
  const scoreColor = (score: number | null) => {
    const colors = { unavailable: 'var(--text-muted, #777)', 'far-below': 'var(--coverage-score-far-below)', below: 'var(--coverage-score-below)', meets: 'var(--coverage-score-meets)', strong: 'var(--coverage-score-strong)' }
    return colors[scoreBand(score)]
  }
  const pageCount = Math.max(1, Math.ceil(sorted.length / COVERAGE_TABLE_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visiblePoints = sorted.slice(currentPage * COVERAGE_TABLE_PAGE_SIZE, (currentPage + 1) * COVERAGE_TABLE_PAGE_SIZE)
  const firstVisible = sorted.length === 0 ? 0 : currentPage * COVERAGE_TABLE_PAGE_SIZE + 1
  const lastVisible = Math.min(sorted.length, (currentPage + 1) * COVERAGE_TABLE_PAGE_SIZE)
  return <section className="leaf-coverage-analysis">
    <h4>Prepared-position depth and evaluation</h4>
    <p className="panel-status">Every authored position is included. Each marker has the same size; its label is the summed probability of reaching its positions, using only opponent response rates.</p>
    {clusters.length > 0 ? <>
      <div className="leaf-chart-scroll"><div className="leaf-chart" role="img" aria-label="Leaf depth by engine evaluation" style={{ width: `${chartWidth}px` }}>
        <span className="leaf-axis-label" style={{ top: `${y(5)}%` }}>+5</span><span className="leaf-axis-label" style={{ top: `${y(0)}%` }}>Equal</span><span className="leaf-axis-label" style={{ top: `${y(-1)}%` }}>−1</span>
        <div className="leaf-zero-line" style={{ top: `${y(0)}%` }} />
        {plottedDepths.map((depth) => <span className="leaf-depth-label" key={depth} style={{ left: `${x(depth)}px` }}>Ply {depth}</span>)}
        {clusters.map((cluster) => <button
          type="button"
          className={`leaf-cluster${selected?.id === cluster.id ? ' selected' : ''}`}
          key={cluster.id}
          style={{ left: `${x(cluster.depth)}px`, top: `${y(cluster.evaluation)}%`, '--cluster-score-color': scoreColor(clusterScore(cluster)) } as CSSProperties}
          aria-label={`${cluster.frequency.toFixed(2)} percent at ply ${cluster.depth}, ${cluster.points.length} position${cluster.points.length === 1 ? '' : 's'}`}
          aria-pressed={selected?.id === cluster.id}
          onClick={() => { setSelected((current) => current?.id === cluster.id ? null : cluster); setPage(0) }}
        ><strong>{cluster.frequency < 0.1 ? '<0.1' : cluster.frequency.toFixed(1)}%</strong><small>{cluster.points.length} position{cluster.points.length === 1 ? '' : 's'}</small></button>)}
      </div></div>
      <div className="coverage-score-legend" aria-label="Plot score color bands"><span>Far below</span><span>Below minimum</span><span>Meets minimum</span><span>Strong</span></div>
    </> : <p className="panel-status">No cached engine evaluations are available for these leaves yet. Background analysis will add points to the graph.</p>}
    <div className="leaf-table-heading">
      <h4>{selected ? `Positions in selected bubble (${selected.points.length})` : 'All prepared positions'}</h4>
      {selected && <button type="button" onClick={() => { setSelected(null); setPage(0) }}>Show all positions</button>}
    </div>
    <div className="leaf-table-wrap"><table className="leaf-table"><colgroup><col className="leaf-col-position" /><col className="leaf-col-missing" /><col className="leaf-col-score" /><col className="leaf-col-ply" /><col className="leaf-col-eval" /><col className="leaf-col-reach" /><col className="leaf-col-children" /><col className="leaf-col-unprepared" /></colgroup><thead><tr>{sortableHeading('position', 'Position')}{sortableHeading('frequency', 'Missing coverage', 'Total opening coverage missing at this position')}{sortableHeading('score', 'Score')}{sortableHeading('depth', 'Ply')}{sortableHeading('evaluation', 'Eval')}{sortableHeading('reach', 'Position rate', 'Sampled opponent-response probability reaching this position')}{sortableHeading('children', 'Prepared replies', 'Share of replies at this position continued into prepared children')}{sortableHeading('unprepared', 'Unprepared replies', 'Share of replies at this position without a prepared continuation')}</tr></thead><tbody>
      {visiblePoints.map((point) => {
        const score = pointScore(point)
        const qualifies = score !== null && score >= scoreParameters.minimumScore
        const band = scoreBand(score)
        return <tr key={point.id ?? point.fen} onClick={() => openPoint(point)}><td><button type="button">{pointName(point)}{point.kind !== 'leaf' ? ' …' : ''}</button></td><td title="Total opening coverage missing at this position">{formatCoveragePercent(point.frequency)}</td><td>{score === null ? <span className="coverage-table-score unavailable" title="Score unavailable">—</span> : <span className={`coverage-table-score ${band}`} title={qualifies ? 'Meets the minimum score' : 'Below the minimum score'}>{Number.isFinite(score) ? score.toFixed(1) : '∞'}</span>}</td><td>{point.depth}</td><td>{point.evaluation ? <CoverageTableEvaluation score={point.evaluation} /> : 'Not cached'}</td><td title="Sampled opponent-response probability reaching this position">{formatCoveragePercent(point.reachFrequency ?? 0)}</td><td title="Share of replies at this position continued into prepared children">{formatCoveragePercent(preparedReplyRate(point))}</td><td title="Share of replies at this position without a prepared continuation">{formatCoveragePercent(unpreparedReplyRate(point))}</td></tr>
      })}
    </tbody></table></div>
    {pageCount > 1 && <nav className="leaf-table-pagination" aria-label="Coverage table pages">
      <button type="button" disabled={currentPage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
      <span>Page {currentPage + 1} of {pageCount} · {firstVisible}–{lastVisible} of {sorted.length}</span>
      <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
    </nav>}
  </section>
}

export function CoverageDashboard({ color, coverageLabel, tree, lines, fullRepertoire = false, signedIn, onOpenPosition }: Props) {
  const positions = useMemo(() => opponentPositions(tree, color), [color, tree])
  const scope = useMemo(() => moduleCoverageScope(lines, color, fullRepertoire), [color, fullRepertoire, lines])
  const nodeFens = useMemo(() => [...new Set([
    normalizeFen(scope.openingFen),
    ...lines.flatMap((line) => line.steps
      .slice(scope.openingPly)
      .map((step) => normalizeFen(step.resultingFen))),
  ])], [lines, scope.openingFen, scope.openingPly])
  const scanPositions = useMemo(() => [...new Set([...nodeFens, ...positions].map(normalizeFen))], [nodeFens, positions])
  const [runId, setRunId] = useState(0)
  const [statsByFen, setStatsByFen] = useState<Record<string, { totalGames: number; moves: import('../types').ExplorerMoveStat[] }>>({})
  const [leafDetails, setLeafDetails] = useState<Record<string, { openingName?: string; evaluation: LeafCoveragePoint['evaluation'] }>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scoreParameters, setScoreParameters] = useState(DEFAULT_LEAF_SCORE_PARAMETERS)

  useEffect(() => {
    setStatsByFen({})
    setLeafDetails({})
    setLoading(false)
    setError(null)
  }, [color, tree])

  useEffect(() => {
    if (!signedIn || scanPositions.length === 0) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const run = async () => {
      try {
        const { positions: snapshots } = await fetchCoverageSnapshots(scanPositions, undefined, controller.signal)
      const stats: Record<string, { totalGames: number; moves: import('../types').ExplorerMoveStat[] }> = {}
      const details: Record<string, { openingName?: string; evaluation: LeafCoveragePoint['evaluation'] }> = {}
      for (const fen of scanPositions) {
        const snapshot = snapshots[fen]
        if (!snapshot) continue
        if (nodeFens.includes(fen)) details[fen] = {
          openingName: snapshot.stats?.opening?.name,
          evaluation: snapshot.evaluation,
        }
        if (!snapshot.stats) continue
        stats[fen] = snapshot.stats
      }
      setStatsByFen(stats)
      setLeafDetails(details)
      setLoading(false)
      } catch (reason) {
        if (controller.signal.aborted) return
        setLoading(false)
        setError(reason instanceof Error ? reason.message : 'Coverage snapshots could not be loaded.')
      }
    }
    void run()
    return () => controller.abort()
  }, [nodeFens, positions, runId, scanPositions, signedIn])

  const evaluationsByFen = Object.fromEntries(Object.entries(leafDetails).map(([fen, detail]) => [fen, detail.evaluation]))
  const coveragePartition = calculateModuleCoveragePartition(
    lines, scope.openingPly, statsByFen, evaluationsByFen, color, scoreParameters,
  )
  const preparedNodes = calculateRepertoireNodeProbabilities(lines, scope.openingPly, statsByFen)
  const ownMoveNodes = preparedNodes.filter((node) => node.mover === 'own')
  const openingFen = normalizeFen(scope.openingFen)
  const openingStats = statsByFen[openingFen]
  const openingSteps = [...new Map(lines.flatMap((line) => {
    const step = line.steps[scope.openingPly]
    return step ? [[canonicalMoveUci(step.uci), step] as const] : []
  })).values()]
  const openingPreparedRate = openingSteps[0]?.mover === 'opponent'
    ? openingSteps.reduce((sum, step) => sum + (openingStats?.moves.find((move) => canonicalMoveUci(move.uci) === canonicalMoveUci(step.uci))?.totalGames ?? 0), 0) / (openingStats?.totalGames || 1)
    : openingSteps.length > 0 ? 1 : 0
  const openingPath = lines[0]?.steps.slice(0, scope.openingPly)
  const openingPoint: LeafCoveragePoint = {
    id: openingPath?.map((step) => step.uci).join(' ') ?? '',
    fen: openingFen,
    depth: scope.openingPly,
    moves: openingPath?.map((step) => step.san) ?? [],
    games: openingStats?.totalGames ?? 0,
    frequency: Math.max(0, 1 - openingPreparedRate) * 100,
    reachFrequency: 100,
    childFrequency: Math.min(1, openingPreparedRate) * 100,
    pathIds: lines[0] ? [lines[0].id] : [],
    kind: openingSteps.length > 0 ? 'internal' : 'leaf',
    occurrenceCount: 1,
    ...leafDetails[openingFen],
  }
  const preparedPoints: LeafCoveragePoint[] = [openingPoint, ...ownMoveNodes.map((node) => ({
    id: node.id,
    fen: node.fen,
    depth: node.depth,
    finalMove: node.finalMove,
    moves: lines.find((line) => line.id === node.pathId)?.steps.slice(scope.openingPly, node.depth).map((step) => step.san),
    games: node.minimumSample,
    frequency: node.exclusiveProbability * 100,
    reachFrequency: node.probability * 100,
    childFrequency: Math.max(0, node.probability - node.exclusiveProbability) * 100,
    pathIds: [node.pathId],
    kind: node.isLeaf ? 'leaf' as const : 'internal' as const,
    occurrenceCount: 1,
    ...leafDetails[node.fen],
  }))]
  const qualifyingNodes = preparedPoints.filter((point) => point.games > 0 && leafQualifiesForCoverage(
    point.depth - scope.openingPly,
    point.evaluation,
    color,
    scoreParameters,
  )).length
  return <section className="coverage-dashboard">
    <h3>{coverageLabel} coverage <span className="development-tag">In development</span></h3>
    {!signedIn ? <p className="panel-status">Sign in to calculate coverage from saved position data.</p> : scope.leafFens.length === 0 ? <p className="panel-status">This selection has no prepared lines yet.</p> : <>
      {!loading && <p className="coverage-score"><strong>{coveragePartition.percent.toFixed(1)}%</strong> of likely opponent play is covered</p>}
      {!loading && <p className="panel-status">
        Coverage is the share of sampled opponent-response probability that reaches a prepared position meeting your current depth and evaluation target. {qualifyingNodes} of {preparedPoints.length} sampled prepared positions meet that target.
      </p>}
      <div className="coverage-score-controls">
        <label>Minimum score <input type="number" step="1" value={scoreParameters.minimumScore} onChange={(event) => setScoreParameters((current) => ({ ...current, minimumScore: Number(event.target.value) }))} /></label>
        <label>Evaluation weight <input type="number" step="0.5" value={scoreParameters.evaluationWeight} onChange={(event) => setScoreParameters((current) => ({ ...current, evaluationWeight: Number(event.target.value) }))} /></label>
        <label>Evaluation floor <input type="number" step="0.1" value={scoreParameters.minimumEvaluation} onChange={(event) => setScoreParameters((current) => ({ ...current, minimumEvaluation: Number(event.target.value) }))} /></label>
      </div>
      {!loading && !error && <PreparedPositionCoverageGraph points={preparedPoints} color={color} openingPly={scope.openingPly} scoreParameters={scoreParameters} onOpenPosition={onOpenPosition} />}
      {loading && <p className="panel-status">Loading saved coverage data…</p>}
      {error && <p className="panel-status error">{error}</p>}
      {!loading && <button type="button" onClick={() => { setStatsByFen({}); setLeafDetails({}); setError(null); setRunId((value) => value + 1) }}>Refresh saved data</button>}
    </>}
  </section>
}
