import { Chess } from 'chess.js'

/**
 * Formats a sequence of SAN moves starting from `fen` with PGN-style move numbers, e.g.
 * "15. c4 Nxc4 16. d4" (starting on White) or "3...Nf6 4. a3 b6" (starting on Black,
 * where the leading "3..." disambiguates that the first move shown is Black's).
 */
export function formatMoveList(fen: string, sanMoves: string[]): string {
  const parts = fen.split(' ')
  let turn: 'w' | 'b' = parts[1] === 'b' ? 'b' : 'w'
  let moveNumber = parseInt(parts[5], 10) || 1

  const tokens: string[] = []
  sanMoves.forEach((san, i) => {
    if (turn === 'w') {
      tokens.push(`${moveNumber}.`, san)
    } else if (i === 0) {
      tokens.push(`${moveNumber}...`, san)
    } else {
      tokens.push(san)
    }
    if (turn === 'b') moveNumber += 1
    turn = turn === 'w' ? 'b' : 'w'
  })

  return tokens.join(' ')
}

/** Converts a sequence of UCI moves (e.g. "e2e4") into SAN, starting from `fen`. */
export function uciLineToSan(fen: string, uciMoves: string[], maxMoves = 6): string[] {
  const chess = new Chess(fen)
  const sanMoves: string[] = []

  for (const uci of uciMoves.slice(0, maxMoves)) {
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined
    try {
      const move = chess.move({ from, to, promotion })
      if (!move) break
      sanMoves.push(move.san)
    } catch {
      break
    }
  }

  return sanMoves
}
