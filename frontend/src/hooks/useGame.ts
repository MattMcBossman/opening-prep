import { useCallback, useMemo, useState } from 'react'
import { Chess } from 'chess.js'

export type HistoryEntry = {
  san: string
  /** UCI notation (e.g. "e2e4") for the move that produced this entry, used as the
   * repertoire move identity so saved moves don't need to be re-derived from SAN. */
  uci: string
  fenAfter: string
}

export type MoveInput = string | { from: string; to: string; promotion?: string }

export const START_FEN = new Chess().fen()

/**
 * Tracks a single line of moves (the position tree/repertoire nodes come in Phase 2)
 * with a "pointer" into that line, so the move list can be navigated like a PGN viewer.
 * Playing a move while the pointer isn't at the tip truncates the forward history,
 * matching standard PGN-editor behavior for branching off an earlier position.
 */
export function useGame() {
  const [baseFen, setBaseFen] = useState(START_FEN)
  const [moves, setMoves] = useState<HistoryEntry[]>([])
  const [pointer, setPointer] = useState(0)

  const fen = pointer === 0 ? baseFen : moves[pointer - 1].fenAfter

  const legalMoves = useMemo(() => new Chess(fen).moves(), [fen])

  const goTo = useCallback(
    (index: number) => {
      setPointer(Math.max(0, Math.min(index, moves.length)))
    },
    [moves.length],
  )

  const goBack = useCallback(() => setPointer((p) => Math.max(0, p - 1)), [])
  const goForward = useCallback(() => setPointer((p) => Math.min(moves.length, p + 1)), [moves.length])

  /**
   * Plays `move` if it's legal here, returning the resulting history entry (or null if
   * it wasn't legal). Returning the entry rather than a bare boolean lets callers react
   * to *what* was played - notably picking the move/capture/check/checkmate sound from
   * its SAN - while still reading as a success check at call sites that don't care.
   */
  const makeMove = useCallback(
    (move: MoveInput): HistoryEntry | null => {
      const trial = new Chess(fen)
      let result
      try {
        result = trial.move(move)
      } catch {
        return null
      }
      if (!result) return null

      const uci = `${result.from}${result.to}${result.promotion ?? ''}`
      const entry: HistoryEntry = { san: result.san, uci, fenAfter: trial.fen() }
      setMoves((prev) => [...prev.slice(0, pointer), entry])
      setPointer((p) => p + 1)
      return entry
    },
    [fen, pointer],
  )

  const reset = useCallback(() => {
    setBaseFen(START_FEN)
    setMoves([])
    setPointer(0)
  }, [])

  /** Replace explorer history with an exact UCI line replayed from move one. */
  const loadLine = useCallback((uciMoves: readonly string[]): boolean => {
    const game = new Chess(START_FEN)
    const history: HistoryEntry[] = []
    try {
      for (const uci of uciMoves) {
        const result = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
        if (!result) return false
        history.push({
          san: result.san,
          uci: `${result.from}${result.to}${result.promotion ?? ''}`,
          fenAfter: game.fen(),
        })
      }
    } catch {
      return false
    }
    setBaseFen(START_FEN)
    setMoves(history)
    setPointer(history.length)
    return true
  }, [])

  /** Open a standalone explorer position when no move-one history is known. */
  const loadPosition = useCallback((nextFen: string): boolean => {
    try {
      const validatedFen = new Chess(nextFen).fen()
      setBaseFen(validatedFen)
      setMoves([])
      setPointer(0)
      return true
    } catch {
      return false
    }
  }, [])

  return {
    fen,
    moves,
    pointer,
    legalMoves,
    isAtEnd: pointer === moves.length,
    goTo,
    goBack,
    goForward,
    makeMove,
    reset,
    loadLine,
    loadPosition,
  }
}
