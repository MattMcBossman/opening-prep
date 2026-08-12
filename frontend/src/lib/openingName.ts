import { formatMoveListFromPly } from './chessUtils'

// Positions at or above this public-Lichess sample size are part of the naming
// guarantee: native Lichess name when present, otherwise deepest named
// ancestor plus the exact intervening move sequence.
export const OPENING_NAME_GUARANTEE_MIN_GAMES = 10_000

/** Extends a native Lichess ancestor name with the exact path to this occurrence. */
export function derivedLichessOpeningName(baseName: string, ancestorPly: number, sanMoves: readonly string[]): string {
  const suffix = formatMoveListFromPly(ancestorPly, [...sanMoves])
    .replace(/^(\d+)\.\.\./, '$1... ')
  return suffix ? `${baseName}, ${suffix}` : baseName
}
