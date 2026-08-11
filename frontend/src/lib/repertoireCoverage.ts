import { START_FEN } from '../hooks/useGame'
import { normalizeFen, sideToMove } from './chessUtils'
import type { EngineEvaluation, ExplorerMoveStat, RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

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
