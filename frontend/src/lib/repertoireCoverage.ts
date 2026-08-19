import { START_FEN } from '../hooks/useGame'
import { canonicalMoveUci, formatMoveListFromPly, normalizeFen, sideToMove } from './chessUtils'
import type { EngineEvaluation, ExplorerMoveStat, RepertoireColor, RepertoireMove, RepertoireTree } from '../types'
import type { DrillLine } from './repertoireDrills'

export type PositionCoverage = {
  fen?: string
  openingName?: string
  evaluation?: Pick<EngineEvaluation, 'scoreType' | 'scoreValue'> | null
  coveredGames: number
  totalGames: number
  percent: number
  coveredMoves: number
  totalMoves: number
}

export const FULLY_COVERED_TARGET_PERCENT = 95
export const LEAF_PREPARATION_MINIMUM_SCORE = 15
export const LEAF_EVALUATION_WEIGHT = 10
export const LEAF_MINIMUM_EVALUATION = -1

export type LeafScoreParameters = {
  minimumScore: number
  evaluationWeight: number
  minimumEvaluation: number
}

export const DEFAULT_LEAF_SCORE_PARAMETERS: LeafScoreParameters = {
  minimumScore: LEAF_PREPARATION_MINIMUM_SCORE,
  evaluationWeight: LEAF_EVALUATION_WEIGHT,
  minimumEvaluation: LEAF_MINIMUM_EVALUATION,
}

export type ModuleCoveragePartition = {
  coveredProbability: number
  failingLeafProbability: number
  unpreparedProbability: number
  unknownProbability: number
  percent: number
}

export type ModuleCoverageScope = {
  openingFen: string
  leafFens: string[]
  openingPly: number
}

export type ModuleLeafCoverage = {
  coveredProbability: number
  preparedProbability: number
  percent: number
  linesWithData: number
  totalLines: number
}

export type LineCoverageProbability = {
  lineId: string
  leafFen: string
  probability: number
  minimumSample: number
  hasAllData: boolean
}

export type RepertoireNodeProbability = {
  id: string
  pathId: string
  fen: string
  depth: number
  finalMove: string
  mover: DrillLine['steps'][number]['mover']
  probability: number
  exclusiveProbability: number
  minimumSample: number
  hasAllData: boolean
  isLeaf: boolean
}

export type LeafCoveragePoint = {
  id?: string
  fen: string
  depth: number
  finalMove?: string
  moves?: string[]
  openingName?: string
  games: number
  frequency: number
  reachFrequency?: number
  childFrequency?: number
  evaluation?: Pick<EngineEvaluation, 'scoreType' | 'scoreValue'> | null
  pathIds: string[]
  kind?: 'internal' | 'leaf' | 'mixed'
  occurrenceCount?: number
}

export function coveragePositionLabel(
  moves: readonly string[] | undefined,
  startPly = 0,
  edgeMoveCount = 3,
): string {
  if (!moves?.length) return 'Opening position'
  if (moves.length <= edgeMoveCount * 2) return formatMoveListFromPly(startPly, [...moves])

  const first = formatMoveListFromPly(startPly, moves.slice(0, edgeMoveCount))
  const lastOffset = moves.length - edgeMoveCount
  const last = formatMoveListFromPly(startPly + lastOffset, moves.slice(lastOffset))
  return `${first} … ${last}`
}

export type LeafCoverageCluster = {
  id: string
  depth: number
  evaluation: number
  frequency: number
  points: LeafCoveragePoint[]
}

/** Convert a White-oriented engine score into a bounded pawn value for plotting. */
export function leafEvaluationValue(point: LeafCoveragePoint, color: RepertoireColor): number | null {
  if (!point.evaluation) return null
  const sign = color === 'white' ? 1 : -1
  if (point.evaluation.scoreType === 'mate') return point.evaluation.scoreValue * sign > 0 ? 5 : -5
  return Math.max(-5, Math.min(5, (point.evaluation.scoreValue * sign) / 100))
}

/**
 * Cluster markers that would collide vertically. Positions must share an
 * exact ply; marker size never represents frequency. Merge the closest
 * adjacent groups first while enforcing a maximum evaluation span. This keeps
 * visually identical boundary values together without allowing a dense chain
 * of small gaps to become one arbitrarily wide cluster.
 */
export function clusterLeafCoverage(
  points: readonly LeafCoveragePoint[],
  color: RepertoireColor,
  evaluationTolerance = 0.58,
): LeafCoverageCluster[] {
  const byDepth = new Map<number, Array<{ point: LeafCoveragePoint; evaluation: number }>>()
  for (const point of points) {
    const evaluation = leafEvaluationValue(point, color)
    if (evaluation === null) continue
    const group = byDepth.get(point.depth) ?? []
    group.push({ point, evaluation })
    byDepth.set(point.depth, group)
  }
  const clusters: LeafCoverageCluster[] = []
  for (const [depth, entries] of byDepth) {
    entries.sort((left, right) => left.evaluation - right.evaluation)
    const groups = entries.map((entry) => [entry])
    while (groups.length > 1) {
      let mergeIndex = -1
      let smallestGap = Infinity
      for (let index = 0; index < groups.length - 1; index += 1) {
        const left = groups[index]
        const right = groups[index + 1]
        const combinedSpan = right[right.length - 1].evaluation - left[0].evaluation
        const gap = right[0].evaluation - left[left.length - 1].evaluation
        if (combinedSpan <= evaluationTolerance && gap < smallestGap) {
          mergeIndex = index
          smallestGap = gap
        }
      }
      if (mergeIndex < 0) break
      groups.splice(mergeIndex, 2, [...groups[mergeIndex], ...groups[mergeIndex + 1]])
    }
    for (const current of groups) {
      const frequency = current.reduce((sum, entry) => sum + entry.point.frequency, 0)
      const weighted = current.reduce((sum, entry) => sum + entry.evaluation * Math.max(entry.point.frequency, 0.0001), 0)
      const weight = current.reduce((sum, entry) => sum + Math.max(entry.point.frequency, 0.0001), 0)
      clusters.push({
        id: `${depth}:${current.map((entry) => entry.point.id ?? entry.point.fen).join('|')}`,
        depth,
        evaluation: weighted / weight,
        frequency,
        points: current.map((entry) => entry.point),
      })
    }
  }
  return clusters.sort((left, right) => left.depth - right.depth || right.evaluation - left.evaluation)
}

/**
 * The module card's opening position is intentionally short: after three
 * common plies for White modules (for example 1.e4 e5 2.Nc3), or two for
 * Black modules (for example 1.e4 c6). If the lines branch sooner, use their
 * most recent common ancestor instead. Identical transposed leaves are counted
 * once because position explorer samples are position-based, not path-based.
 */
export function moduleCoverageScope(
  lines: readonly DrillLine[],
  color: RepertoireColor,
  fullRepertoire = false,
): ModuleCoverageScope {
  if (lines.length === 0) return { openingFen: normalizeFen(START_FEN), leafFens: [], openingPly: 0 }
  const shortest = Math.min(...lines.map((line) => line.steps.length))
  let commonPlies = 0
  for (; commonPlies < shortest; commonPlies += 1) {
    const uci = lines[0].steps[commonPlies].uci
    if (lines.some((line) => line.steps[commonPlies].uci !== uci)) break
  }
  const listedOpeningPlies = color === 'white' ? 3 : 2
  const openingPly = fullRepertoire
    ? color === 'white' ? 1 : 0
    : Math.min(commonPlies, listedOpeningPlies)
  const openingFen = openingPly === 0
    ? normalizeFen(START_FEN)
    : normalizeFen(lines[0].steps[openingPly - 1].resultingFen)
  const leafFens = [...new Set(lines.flatMap((line) => {
    const leaf = line.steps.at(-1)?.resultingFen
    return leaf ? [normalizeFen(leaf)] : []
  }))]
  return { openingFen, leafFens, openingPly }
}

export function calculateModuleLeafCoverage(
  lines: readonly LineCoverageProbability[],
  qualifies: (line: LineCoverageProbability) => boolean = () => true,
): ModuleLeafCoverage {
  const sampled = lines.filter((line) => line.hasAllData)
  const complete = sampled.filter(qualifies)
  const preparedProbability = sampled.reduce((sum, line) => sum + line.probability, 0)
  const coveredProbability = complete.reduce((sum, line) => sum + line.probability, 0)
  return {
    coveredProbability,
    preparedProbability,
    percent: preparedProbability === 0 ? 0 : Math.min(100, (coveredProbability / preparedProbability) * 100),
    linesWithData: complete.length,
    totalLines: lines.length,
  }
}

export function repertoireEvaluationPawns(
  evaluation: Pick<EngineEvaluation, 'scoreType' | 'scoreValue'>,
  color: RepertoireColor,
): number {
  const sign = color === 'white' ? 1 : -1
  if (evaluation.scoreType === 'mate') return evaluation.scoreValue * sign > 0 ? Infinity : -Infinity
  return (evaluation.scoreValue * sign) / 100
}

export function leafPreparationScore(
  pliesBeyondOpening: number,
  evaluation: Pick<EngineEvaluation, 'scoreType' | 'scoreValue'> | null | undefined,
  color: RepertoireColor,
  parameters: LeafScoreParameters = DEFAULT_LEAF_SCORE_PARAMETERS,
): number | null {
  if (!evaluation) return null
  const pawns = repertoireEvaluationPawns(evaluation, color)
  if (pawns === Infinity) return Infinity
  if (pawns === -Infinity || pawns < parameters.minimumEvaluation) return null
  return pliesBeyondOpening + parameters.evaluationWeight * pawns
}

export function leafQualifiesForCoverage(
  pliesBeyondOpening: number,
  evaluation: Pick<EngineEvaluation, 'scoreType' | 'scoreValue'> | null | undefined,
  color: RepertoireColor,
  parameters: LeafScoreParameters = DEFAULT_LEAF_SCORE_PARAMETERS,
): boolean {
  const score = leafPreparationScore(pliesBeyondOpening, evaluation, color, parameters)
  return score !== null && score >= parameters.minimumScore
}

type CoverageTrieNode = {
  fen: string
  mover?: DrillLine['steps'][number]['mover']
  children: Map<string, { step: DrillLine['steps'][number]; node: CoverageTrieNode }>
}

export function calculateModuleCoveragePartition(
  lines: readonly DrillLine[],
  openingPly: number,
  statsByFen: Readonly<Record<string, { totalGames: number; moves: ExplorerMoveStat[] }>>,
  evaluationsByFen: Readonly<Record<string, Pick<EngineEvaluation, 'scoreType' | 'scoreValue'> | null | undefined>>,
  color: RepertoireColor,
  parameters: LeafScoreParameters = DEFAULT_LEAF_SCORE_PARAMETERS,
): ModuleCoveragePartition {
  const root: CoverageTrieNode = { fen: '', children: new Map() }
  for (const line of lines) {
    let node = root
    for (const step of line.steps.slice(openingPly)) {
      let edge = node.children.get(step.uci)
      if (!edge) {
        edge = { step, node: { fen: normalizeFen(step.resultingFen), mover: step.mover, children: new Map() } }
        node.children.set(step.uci, edge)
      }
      node = edge.node
    }
  }

  const walk = (node: CoverageTrieNode, reach: number, depth: number): Omit<ModuleCoveragePartition, 'percent'> => {
    // Preparation is monotonic: once any authored position is deep/good enough
    // to satisfy the score, optional continuations beneath it cannot turn that
    // already-prepared probability back into uncovered probability.
    if (node.fen && node.mover === 'own' && leafQualifiesForCoverage(depth, evaluationsByFen[node.fen], color, parameters)) {
      return {
        coveredProbability: reach,
        failingLeafProbability: 0,
        unpreparedProbability: 0,
        unknownProbability: 0,
      }
    }
    if (node.children.size === 0) {
      return {
        coveredProbability: 0,
        failingLeafProbability: reach,
        unpreparedProbability: 0,
        unknownProbability: 0,
      }
    }
    const edges = [...node.children.values()]
    if (edges[0].step.mover === 'own') {
      // A personal module's single-response invariant permits only one edge here.
      return walk(edges[0].node, reach, depth + 1)
    }
    const stats = statsByFen[normalizeFen(edges[0].step.fen)]
    if (!stats || stats.totalGames <= 0) {
      return { coveredProbability: 0, failingLeafProbability: 0, unpreparedProbability: 0, unknownProbability: reach }
    }
    const result = { coveredProbability: 0, failingLeafProbability: 0, unpreparedProbability: 0, unknownProbability: 0 }
    let preparedProbability = 0
    for (const edge of edges) {
      const move = stats.moves.find((candidate) => canonicalMoveUci(candidate.uci) === canonicalMoveUci(edge.step.uci))
      // Explorer returns only its leading moves. A prepared move omitted from
      // that list has no measurable share of the sampled response
      // probability, so it contributes zero rather than making the entire
      // unlisted tail unknowable.
      if (!move) continue
      const probability = move.totalGames / stats.totalGames
      preparedProbability += probability
      const child = walk(edge.node, reach * probability, depth + 1)
      result.coveredProbability += child.coveredProbability
      result.failingLeafProbability += child.failingLeafProbability
      result.unpreparedProbability += child.unpreparedProbability
      result.unknownProbability += child.unknownProbability
    }
    const remaining = reach * Math.max(0, 1 - preparedProbability)
    result.unpreparedProbability += remaining
    return result
  }

  const partition = walk(root, 1, 0)
  return { ...partition, percent: partition.coveredProbability * 100 }
}

export function calculateLineCoverageProbabilities(
  lines: readonly DrillLine[],
  openingPly: number,
  statsByFen: Readonly<Record<string, { totalGames: number; moves: ExplorerMoveStat[] }>>,
): LineCoverageProbability[] {
  const seenPaths = new Set<string>()
  return lines.flatMap((line) => {
    const pathKey = line.steps.map((step) => step.uci).join(' ')
    if (seenPaths.has(pathKey)) return []
    seenPaths.add(pathKey)
    const leaf = line.steps.at(-1)?.resultingFen
    if (!leaf) return []
    let probability = 1
    let minimumSample = Infinity
    let hasAllData = true
    for (const step of line.steps.slice(openingPly)) {
      if (step.mover !== 'opponent') continue
      const stats = statsByFen[normalizeFen(step.fen)]
      const move = stats?.moves.find((candidate) => canonicalMoveUci(candidate.uci) === canonicalMoveUci(step.uci))
      if (!stats || stats.totalGames <= 0 || !move) {
        hasAllData = false
        continue
      }
      probability *= move.totalGames / stats.totalGames
      minimumSample = Math.min(minimumSample, stats.totalGames)
    }
    return [{
      lineId: line.id,
      leafFen: normalizeFen(leaf),
      probability: hasAllData ? probability : 0,
      minimumSample: Number.isFinite(minimumSample) ? minimumSample : 0,
      hasAllData,
    }]
  })
}

/**
 * Enumerate every distinct authored prefix after the module opening. Shared
 * prefixes appear once, while different move orders that transpose into the
 * same FEN remain separate probability-bearing occurrences.
 */
export function calculateRepertoireNodeProbabilities(
  lines: readonly DrillLine[],
  openingPly: number,
  statsByFen: Readonly<Record<string, { totalGames: number; moves: ExplorerMoveStat[] }>>,
): RepertoireNodeProbability[] {
  const ownChoices = new Map<string, Set<string>>()
  for (const line of lines) {
    const prefix: string[] = []
    line.steps.forEach((step, index) => {
      if (index >= openingPly && step.mover === 'own') {
        const key = prefix.join(' ')
        const choices = ownChoices.get(key) ?? new Set<string>()
        choices.add(step.uci)
        ownChoices.set(key, choices)
      }
      prefix.push(step.uci)
    })
  }
  const nodes = new Map<string, RepertoireNodeProbability>()
  for (const line of lines) {
    let probability = 1
    let minimumSample = Infinity
    let hasAllData = true
    const path: string[] = []
    line.steps.forEach((step, index) => {
      const originPath = path.join(' ')
      path.push(step.uci)
      if (index < openingPly) return
      if (step.mover === 'own') probability /= ownChoices.get(originPath)?.size ?? 1
      if (step.mover === 'opponent') {
        const stats = statsByFen[normalizeFen(step.fen)]
        const move = stats?.moves.find((candidate) => canonicalMoveUci(candidate.uci) === canonicalMoveUci(step.uci))
        if (!stats || stats.totalGames <= 0 || !move) {
          hasAllData = false
        } else {
          probability *= move.totalGames / stats.totalGames
          minimumSample = Math.min(minimumSample, stats.totalGames)
        }
      }
      const id = path.join(' ')
      const existing = nodes.get(id)
      const node = {
        id,
        pathId: line.id,
        fen: normalizeFen(step.resultingFen),
        depth: index + 1,
        finalMove: step.san,
        mover: step.mover,
        probability: hasAllData ? probability : 0,
        exclusiveProbability: hasAllData ? probability : 0,
        minimumSample: Number.isFinite(minimumSample) ? minimumSample : 0,
        hasAllData,
        isLeaf: index === line.steps.length - 1,
      }
      if (!existing) nodes.set(id, node)
      else if (node.isLeaf && !existing.isLeaf) nodes.set(id, { ...existing, isLeaf: true })
    })
  }
  const result = [...nodes.values()]
  const ownNodes = result.filter((node) => node.mover === 'own').sort((left, right) => left.depth - right.depth)
  const ownById = new Map(ownNodes.map((node) => [node.id, node]))
  for (const node of ownNodes) {
    const parts = node.id.split(' ')
    let parent: RepertoireNodeProbability | undefined
    for (let length = parts.length - 1; length > 0 && !parent; length -= 1) parent = ownById.get(parts.slice(0, length).join(' '))
    if (parent) parent.exclusiveProbability = Math.max(0, parent.exclusiveProbability - node.probability)
  }
  return result
}

/**
 * Turns raw uncovered-game exposure into a practical priority. Engine scores are
 * from White's perspective, so first convert them to the repertoire side's view.
 * A favorable position is easier to handle and is exponentially discounted;
 * equal or worse positions retain their full observed exposure.
 */
export function coverageGapImpact(position: PositionCoverage, color: RepertoireColor): number {
  const uncoveredGames = position.totalGames - position.coveredGames
  if (!position.evaluation) return uncoveredGames
  const repertoireSign = color === 'white' ? 1 : -1
  if (position.evaluation.scoreType === 'mate') {
    return position.evaluation.scoreValue * repertoireSign > 0 ? uncoveredGames * 0.01 : uncoveredGames
  }
  const repertoireAdvantage = (position.evaluation.scoreValue * repertoireSign) / 100
  const favorableAdvantage = Math.min(5, Math.max(0, repertoireAdvantage))
  return uncoveredGames * Math.exp(-0.8 * favorableAdvantage)
}

export function rankCoverageGaps(positions: readonly PositionCoverage[], color: RepertoireColor): PositionCoverage[] {
  return [...positions]
    .filter((position) => position.totalGames - position.coveredGames > 0)
    .sort((left, right) =>
      coverageGapImpact(right, color) - coverageGapImpact(left, color)
      || right.totalGames - left.totalGames,
    )
}

export function opponentPositions(tree: RepertoireTree, color: RepertoireColor): string[] {
  const positions = new Set<string>()
  const root = normalizeFen(START_FEN)
  if (sideToMove(root) !== color) positions.add(root)
  for (const moves of Object.values(tree)) {
    for (const move of moves) {
      const resulting = normalizeFen(move.resultingFen)
      if (sideToMove(resulting) !== color) positions.add(resulting)
    }
  }
  return [...positions]
}

export type CoverageDashboardSummary = {
  percent: number
  coveredPositions: number
  partiallyCoveredPositions: number
  noDataPositions: number
  totalPositions: number
  coveredReplyWeight: number
  totalReplyWeight: number
}

export function aggregatePositionCoverage(positions: readonly PositionCoverage[]): CoverageDashboardSummary {
  const scored = positions.filter((position) => position.totalGames > 0)
  const coveredReplyWeight = scored.reduce((sum, position) => sum + position.coveredGames, 0)
  const totalReplyWeight = scored.reduce((sum, position) => sum + position.totalGames, 0)
  const coveredPositions = scored.filter((position) => position.percent >= FULLY_COVERED_TARGET_PERCENT).length
  return {
    percent: totalReplyWeight === 0 ? 0 : (coveredReplyWeight / totalReplyWeight) * 100,
    coveredPositions,
    partiallyCoveredPositions: scored.length - coveredPositions,
    noDataPositions: positions.length - scored.length,
    totalPositions: positions.length,
    coveredReplyWeight,
    totalReplyWeight,
  }
}

export function calculatePositionCoverage(
  explorerMoves: readonly ExplorerMoveStat[],
  savedReplies: readonly RepertoireMove[],
  getResponses: (fen: string) => readonly RepertoireMove[],
): PositionCoverage {
  const savedByUci = new Map(savedReplies.map((move) => [canonicalMoveUci(move.uci), move]))
  let coveredGames = 0
  let totalGames = 0
  let coveredMoves = 0
  for (const candidate of explorerMoves) {
    totalGames += candidate.totalGames
    const saved = savedByUci.get(canonicalMoveUci(candidate.uci))
    if (saved && getResponses(saved.resultingFen).length > 0) {
      coveredGames += candidate.totalGames
      coveredMoves += 1
    }
  }
  return {
    coveredGames,
    totalGames,
    percent: totalGames === 0 ? 0 : (coveredGames / totalGames) * 100,
    coveredMoves,
    totalMoves: explorerMoves.length,
  }
}
