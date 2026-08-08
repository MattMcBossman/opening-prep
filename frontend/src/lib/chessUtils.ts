import { Chess } from 'chess.js'
import type { HistoryEntry } from '../hooks/useGame'
import { START_FEN } from '../hooks/useGame'
import type { RepertoireColor } from '../types'

/** Origin FEN (position before the move was played) for the ply at `index` in `moves`. */
export function originFenForPly(moves: HistoryEntry[], index: number): string {
  return index === 0 ? START_FEN : moves[index - 1].fenAfter
}

/** Which color is to move in `fen`. */
export function sideToMove(fen: string): RepertoireColor {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

/**
 * Normalizes a FEN for use as a repertoire/position-identity key by dropping the
 * halfmove clock and fullmove number (fields 5 and 6). Two FENs that differ only in
 * those fields represent the exact same position, typically reached via a different
 * move order or move count (a transposition) — see AGENTS.md's "position identity via
 * FEN" decision. The board, side-to-move, castling rights, and en-passant target
 * (fields 1-4) are kept as-is.
 */
export function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/**
 * Restores the halfmove-clock and fullmove-number fields that `normalizeFen`
 * drops, so a repertoire/drill position key can be handed to consumers that
 * expect a complete FEN (Stockfish's `position fen`, the Lichess explorer's
 * `fen` parameter). The move number comes from an explicit ply count, since a
 * normalized FEN has no record of it (see `formatMoveListFromPly`); the halfmove
 * clock isn't recoverable at all and is reported as 0, which is harmless for
 * opening positions - nothing here depends on the 50-move rule.
 */
export function denormalizeFen(fen: string, ply: number): string {
  const parts = fen.split(' ')
  if (parts.length >= 6) return fen
  return [...parts.slice(0, 4), parts[4] ?? '0', String(Math.floor(ply / 2) + 1)].join(' ')
}

/**
 * Formats a sequence of SAN moves, starting `startPly` half-moves into the game
 * (0 = White's 1st move, 1 = Black's 1st move, 2 = White's 2nd move, ...), with
 * PGN-style move numbers, e.g. "15. c4 Nxc4 16. d4" (starting on White) or
 * "3...Nf6 4. a3 b6" (starting on Black, where the leading "3..." disambiguates
 * that the first move shown is Black's).
 *
 * Takes an explicit ply count rather than deriving it from a FEN's own
 * halfmove-clock/fullmove-number fields, since those are unreliable in this app:
 * normalized FENs (see `normalizeFen`) deliberately drop them for position-identity
 * purposes, so a FEN alone can't be trusted to say which move number a drill
 * position is actually at - see `formatMoveList` for FEN-based callers that do
 * have a reliable (non-normalized) FEN to derive it from instead.
 */
export function formatMoveListFromPly(startPly: number, sanMoves: string[]): string {
  let turn: 'w' | 'b' = startPly % 2 === 0 ? 'w' : 'b'
  let moveNumber = Math.floor(startPly / 2) + 1

  const tokens: string[] = []
  sanMoves.forEach((san, i) => {
    if (turn === 'w') {
      tokens.push(`${moveNumber}.`, san)
    } else if (i === 0) {
      // Combined into one token (unlike the "N." case above) so `.join(' ')`
      // below doesn't insert a space between "N..." and the move, matching
      // standard PGN style ("3...Nf6", not "3... Nf6").
      tokens.push(`${moveNumber}...${san}`)
    } else {
      tokens.push(san)
    }
    if (turn === 'b') moveNumber += 1
    turn = turn === 'w' ? 'b' : 'w'
  })

  return tokens.join(' ')
}

/**
 * FEN-based convenience wrapper for `formatMoveListFromPly`, for callers with a
 * real (non-normalized) FEN whose own halfmove-clock/fullmove-number fields are
 * reliable - e.g. the explorer, which always works with actual chess.js FENs.
 */
export function formatMoveList(fen: string, sanMoves: string[]): string {
  const parts = fen.split(' ')
  const turn = parts[1] === 'b' ? 'b' : 'w'
  const moveNumber = parseInt(parts[5], 10) || 1
  const startPly = (moveNumber - 1) * 2 + (turn === 'b' ? 1 : 0)
  return formatMoveListFromPly(startPly, sanMoves)
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
