/**
 * Board squares in FEN piece-placement order: rank 8 down to rank 1, each rank
 * a-file through h-file. Index i here corresponds to expandBoard(fen)[i].
 */
export const FEN_SQUARE_ORDER: string[] = (() => {
  const squares: string[] = []
  for (let rank = 8; rank >= 1; rank--) {
    for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      squares.push(`${file}${rank}`)
    }
  }
  return squares
})()

/**
 * Expands a FEN's piece-placement field (the part before the first space) into
 * exactly 64 characters, one per square in `FEN_SQUARE_ORDER`, using "1" for
 * every empty square. FEN run-length-encodes consecutive empty squares as a
 * single digit (e.g. "3" meaning three empty squares in a row); this un-does
 * that so the two boards being compared are always the same length and can be
 * compared position-by-position.
 */
export function expandBoard(fen: string): string[] {
  const placement = fen.split(' ')[0]
  const squares: string[] = []
  for (const rank of placement.split('/')) {
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        squares.push(...Array(Number(ch)).fill('1'))
      } else {
        squares.push(ch)
      }
    }
  }
  return squares
}

/**
 * Hamming distance between two positions: the number of the 64 squares whose
 * occupant (piece, or empty) differs between `fenA` and `fenB`. 0 means the
 * two positions have identical piece placement (though side-to-move,
 * castling rights, etc. may still differ - see normalizeFen for full position
 * identity). Larger distances mean less similar positions.
 */
export function hammingDistance(fenA: string, fenB: string): number {
  const a = expandBoard(fenA)
  const b = expandBoard(fenB)
  let distance = 0
  for (let i = 0; i < FEN_SQUARE_ORDER.length; i++) {
    if (a[i] !== b[i]) distance++
  }
  return distance
}

/** Which squares differ between two positions, e.g. for highlighting the board. */
export function differingSquares(fenA: string, fenB: string): string[] {
  const a = expandBoard(fenA)
  const b = expandBoard(fenB)
  const squares: string[] = []
  for (let i = 0; i < FEN_SQUARE_ORDER.length; i++) {
    if (a[i] !== b[i]) squares.push(FEN_SQUARE_ORDER[i])
  }
  return squares
}

export type SimilarPositionMatch = {
  fen: string
  distance: number
  differingSquares: string[]
}

/**
 * Finds the closest position to `fen` among `candidateFens` by Hamming
 * distance, ignoring an exact match (distance 0, e.g. `fen` itself) since
 * that's a true transposition rather than merely a "similar" position - see
 * AGENTS.md's "position identity via FEN" vs. the (long-term) similar-position
 * suggestion feature. Returns null if nothing is within `maxDistance`.
 */
export function findNearestSimilarPosition(
  fen: string,
  candidateFens: Iterable<string>,
  maxDistance: number,
): SimilarPositionMatch | null {
  let best: SimilarPositionMatch | null = null
  for (const candidate of candidateFens) {
    const distance = hammingDistance(fen, candidate)
    if (distance === 0) continue
    if (distance > maxDistance) continue
    if (!best || distance < best.distance) {
      best = { fen: candidate, distance, differingSquares: differingSquares(fen, candidate) }
    }
  }
  return best
}
