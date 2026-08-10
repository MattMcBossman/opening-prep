import type { EngineEvaluation, ExplorerMoveStat, ExplorerResponse } from '../types'

export type CommonContinuation = ExplorerMoveStat & { percentage: number }

/**
 * Turns Stockfish's numeric score into a deliberately modest, position-specific
 * verdict. This describes the evaluation only; it does not pretend that a
 * single principal variation explains strategic plans in the position.
 */
export function describePositionEvaluation(evaluation: EngineEvaluation): string {
  if (evaluation.terminal) {
    if (evaluation.scoreType === 'mate' && evaluation.scoreValue !== 0) {
      return `${evaluation.scoreValue > 0 ? 'White' : 'Black'} has checkmated.`
    }
    return 'The game is over in this position.'
  }

  if (evaluation.scoreType === 'mate') {
    if (evaluation.scoreValue === 0) return 'Stockfish sees no forced win.'
    return `Stockfish finds a forced mate for ${evaluation.scoreValue > 0 ? 'White' : 'Black'}.`
  }

  const magnitude = Math.abs(evaluation.scoreValue)
  if (magnitude < 20) return 'Stockfish assesses the position as roughly equal.'

  const side = evaluation.scoreValue > 0 ? 'White' : 'Black'
  if (magnitude < 80) return `Stockfish gives ${side} a slight edge.`
  if (magnitude < 180) return `Stockfish gives ${side} a clear advantage.`
  return `Stockfish sees ${side} as winning.`
}

/** Most frequent empirical continuations, suitable for secondary board arrows. */
export function commonContinuations(
  explorer: ExplorerResponse | null,
  engineBestMove: string | null,
  limit = 3,
): CommonContinuation[] {
  if (!explorer || explorer.totalGames <= 0) return []
  return explorer.moves
    .map((move) => ({ ...move, percentage: (move.totalGames / explorer.totalGames) * 100 }))
    .filter((move) => move.uci !== engineBestMove && move.percentage >= 5)
    .sort((a, b) => b.totalGames - a.totalGames)
    .slice(0, limit)
}

export function describeCommonContinuations(explorer: ExplorerResponse | null): string | null {
  if (!explorer || explorer.totalGames <= 0 || explorer.moves.length === 0) return null
  const moves = explorer.moves
    .slice()
    .sort((a, b) => b.totalGames - a.totalGames)
    .slice(0, 3)
    .map((move) => `${move.san} ${Math.round((move.totalGames / explorer.totalGames) * 100)}%`)
  return `Most common in the Lichess sample: ${moves.join(', ')}.`
}
