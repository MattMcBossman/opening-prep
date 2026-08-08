import type { MoveSound } from '../types'

/**
 * Picks the audio cue for a move from its SAN, which already encodes everything the
 * four sounds need to distinguish: `#` for checkmate, `+` for check, and `x` for a
 * capture (including en passant, which chess.js writes as e.g. "exd6").
 *
 * Reading SAN rather than re-deriving state from the resulting FEN keeps this a pure
 * string function - no board setup, no chess.js instance - and means the same
 * classification works anywhere a move is known only by its notation.
 *
 * A move can qualify for several cues at once (a capture that delivers mate is all
 * three), so they're checked most-significant first and only one is returned:
 * checkmate > check > capture > move.
 */
export function classifyMoveSound(san: string): MoveSound {
  if (san.includes('#')) return 'checkmate'
  if (san.includes('+')) return 'check'
  if (san.includes('x')) return 'capture'
  return 'move'
}
