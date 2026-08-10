import { START_FEN } from '../hooks/useGame'
import { normalizeFen, sideToMove } from './chessUtils'
import type { ExplorerMoveStat, RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

export type PositionCoverage = {
  coveredGames: number
  totalGames: number
  percent: number
  coveredMoves: number
  totalMoves: number
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
  totalPositions: number
  coveredReplyWeight: number
  totalReplyWeight: number
}

export function aggregatePositionCoverage(positions: readonly PositionCoverage[]): CoverageDashboardSummary {
  const scored = positions.filter((position) => position.totalGames > 0)
  const coveredReplyWeight = scored.reduce((sum, position) => sum + position.coveredGames, 0)
  const totalReplyWeight = scored.reduce((sum, position) => sum + position.totalGames, 0)
  return {
    percent: scored.length === 0 ? 0 : scored.reduce((sum, position) => sum + position.percent, 0) / scored.length,
    coveredPositions: scored.filter((position) => position.percent >= 99.999).length,
    totalPositions: scored.length,
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
