import { useCallback, useMemo, useState } from 'react'
import { Chess } from 'chess.js'

export type HistoryEntry = {
  san: string
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
  const [moves, setMoves] = useState<HistoryEntry[]>([])
  const [pointer, setPointer] = useState(0)

  const fen = pointer === 0 ? START_FEN : moves[pointer - 1].fenAfter

  const legalMoves = useMemo(() => new Chess(fen).moves(), [fen])

  const goTo = useCallback(
    (index: number) => {
      setPointer(Math.max(0, Math.min(index, moves.length)))
    },
    [moves.length],
  )

  const goBack = useCallback(() => setPointer((p) => Math.max(0, p - 1)), [])
  const goForward = useCallback(() => setPointer((p) => Math.min(moves.length, p + 1)), [moves.length])

  const makeMove = useCallback(
    (move: MoveInput): boolean => {
      const trial = new Chess(fen)
      let result
      try {
        result = trial.move(move)
      } catch {
        return false
      }
      if (!result) return false

      setMoves((prev) => [...prev.slice(0, pointer), { san: result.san, fenAfter: trial.fen() }])
      setPointer((p) => p + 1)
      return true
    },
    [fen, pointer],
  )

  const reset = useCallback(() => {
    setMoves([])
    setPointer(0)
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
  }
}
