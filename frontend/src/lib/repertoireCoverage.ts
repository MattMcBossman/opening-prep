import { START_FEN } from '../hooks/useGame'
import { normalizeFen, sideToMove } from './chessUtils'
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

export type ModuleCoverageScope = {
  openingFen: string
  leafFens: string[]
  openingPly: number
}

export type ModuleLeafCoverage = {
  leafGames: number
  openingGames: number
  percent: number
  leavesWithData: number
  totalLeaves: number
}

/**
 * The module card's opening position is intentionally short: after three
 * common plies for White modules (for example 1.e4 e5 2.Nc3), or two for
 * Black modules (for example 1.e4 c6). If the lines branch sooner, use their
 * most recent common ancestor instead. Identical transposed leaves are counted
 * once because position explorer samples are position-based, not path-based.
 */
export function moduleCoverageScope(lines: readonly DrillLine[], color: RepertoireColor): ModuleCoverageScope {
  if (lines.length === 0) return { openingFen: normalizeFen(START_FEN), leafFens: [], openingPly: 0 }
  const shortest = Math.min(...lines.map((line) => line.steps.length))
  let commonPlies = 0
  for (; commonPlies < shortest; commonPlies += 1) {
    const uci = lines[0].steps[commonPlies].uci
    if (lines.some((line) => line.steps[commonPlies].uci !== uci)) break
  }
  const listedOpeningPlies = color === 'white' ? 3 : 2
  const openingPly = Math.min(commonPlies, listedOpeningPlies)
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
  scope: ModuleCoverageScope,
  gamesByFen: Readonly<Record<string, number>>,
): ModuleLeafCoverage {
  const openingGames = gamesByFen[scope.openingFen] ?? 0
  const samples = scope.leafFens.map((fen) => gamesByFen[fen] ?? 0)
  const leafGames = samples.reduce((sum, games) => sum + games, 0)
  return {
    leafGames,
    openingGames,
    percent: openingGames === 0 ? 0 : Math.min(100, (leafGames / openingGames) * 100),
    leavesWithData: samples.filter((games) => games > 0).length,
    totalLeaves: scope.leafFens.length,
  }
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
  const savedByUci = new Map(savedReplies.map((move) => [move.uci, move]))
  let coveredGames = 0
  let totalGames = 0
  let coveredMoves = 0
  for (const candidate of explorerMoves) {
    totalGames += candidate.totalGames
    const saved = savedByUci.get(candidate.uci)
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
