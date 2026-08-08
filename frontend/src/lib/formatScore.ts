import type { EngineEvaluation } from '../types'

/**
 * Formats an evaluation as a signed pawn score (e.g. "+1.25"), a forced-mate count
 * (e.g. "M3" for mate in 3 plies), or just "M" when checkmate has already happened.
 */
export function formatScore(evaluation: EngineEvaluation): string {
  if (evaluation.scoreType === 'mate') {
    return evaluation.terminal ? 'M' : `M${Math.abs(evaluation.scoreValue)}`
  }
  const pawns = evaluation.scoreValue / 100
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`
}
