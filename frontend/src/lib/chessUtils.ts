import { Chess } from 'chess.js'

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
