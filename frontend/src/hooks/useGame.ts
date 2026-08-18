import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'

export type HistoryEntry = {
  san: string
  /** UCI notation (e.g. "e2e4") for the move that produced this entry, used as the
   * repertoire move identity so saved moves don't need to be re-derived from SAN. */
  uci: string
  fenAfter: string
}
export type GameSnapshot = { baseFen: string; moves: HistoryEntry[]; pointer: number }

export type MoveInput = string | { from: string; to: string; promotion?: string }
export type BoardTransition =
  | { kind: 'history'; fromPointer: number; toPointer: number }
  | { kind: 'direct' }

export const START_FEN = new Chess().fen()
const SESSION_STORAGE_KEY = 'opening-prep:explorer-session:v1'

type StoredGame = { baseFen: string; moves: HistoryEntry[]; pointer: number }

function readStoredGame(): StoredGame {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? 'null') as Partial<StoredGame> | null
    const baseFen = new Chess(parsed?.baseFen ?? START_FEN).fen()
    const game = new Chess(baseFen)
    const moves: HistoryEntry[] = []
    for (const stored of parsed?.moves ?? []) {
      const result = game.move({ from: stored.uci.slice(0, 2), to: stored.uci.slice(2, 4), promotion: stored.uci.slice(4) || undefined })
      if (!result) throw new Error('Invalid stored move')
      moves.push({ san: result.san, uci: `${result.from}${result.to}${result.promotion ?? ''}`, fenAfter: game.fen() })
    }
    return { baseFen, moves, pointer: Math.max(0, Math.min(parsed?.pointer ?? moves.length, moves.length)) }
  } catch {
    return { baseFen: START_FEN, moves: [], pointer: 0 }
  }
}

/**
 * Tracks a single line of moves (the position tree/repertoire nodes come in Phase 2)
 * with a "pointer" into that line, so the move list can be navigated like a PGN viewer.
 * Playing a move while the pointer isn't at the tip truncates the forward history,
 * matching standard PGN-editor behavior for branching off an earlier position.
 */
export function useGame() {
  const [initial] = useState(readStoredGame)
  const [baseFen, setBaseFen] = useState(initial.baseFen)
  const [moves, setMoves] = useState<HistoryEntry[]>(initial.moves)
  const [pointer, setPointer] = useState(initial.pointer)
  const [boardTransition, setBoardTransition] = useState<BoardTransition>({ kind: 'direct' })

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ baseFen, moves, pointer }))
    } catch {
      // Browsing still works when storage is unavailable.
    }
  }, [baseFen, moves, pointer])

  const fen = pointer === 0 ? baseFen : moves[pointer - 1].fenAfter

  const legalMoves = useMemo(() => new Chess(fen).moves(), [fen])

  const goTo = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(index, moves.length))
      setBoardTransition({ kind: 'history', fromPointer: pointer, toPointer: target })
      setPointer(target)
    },
    [moves.length, pointer],
  )

  const goBack = useCallback(() => goTo(pointer - 1), [goTo, pointer])
  const goForward = useCallback(() => goTo(pointer + 1), [goTo, pointer])

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

      setBoardTransition({ kind: 'direct' })
      const uci = `${result.from}${result.to}${result.promotion ?? ''}`
      const entry: HistoryEntry = { san: result.san, uci, fenAfter: trial.fen() }
      setMoves((prev) => [...prev.slice(0, pointer), entry])
      setPointer((p) => p + 1)
      return entry
    },
    [fen, pointer],
  )

  const reset = useCallback(() => {
    setBoardTransition({ kind: 'direct' })
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
    setBoardTransition({ kind: 'direct' })
    setMoves(history)
    setPointer(history.length)
    return true
  }, [])

  /** Open a standalone explorer position when no move-one history is known. */
  const loadPosition = useCallback((nextFen: string): boolean => {
    try {
      const validatedFen = new Chess(nextFen).fen()
      setBoardTransition({ kind: 'direct' })
      setBaseFen(validatedFen)
      setMoves([])
      setPointer(0)
      return true
    } catch {
      return false
    }
  }, [])

  const snapshot = useMemo<GameSnapshot>(() => ({ baseFen, moves, pointer }), [baseFen, moves, pointer])
  const restoreSnapshot = useCallback((saved: GameSnapshot) => {
    setBoardTransition({ kind: 'direct' })
    setBaseFen(saved.baseFen)
    setMoves(saved.moves)
    setPointer(saved.pointer)
  }, [])

  /** Atomically append a clicked saved subtree path from the current position. */
  const loadContinuationPath = useCallback((uciMoves: readonly string[]): boolean => {
    const game = new Chess(fen)
    const appended: HistoryEntry[] = []
    try {
      for (const uci of uciMoves) {
        const result = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
        if (!result) return false
        appended.push({
          san: result.san,
          uci: `${result.from}${result.to}${result.promotion ?? ''}`,
          fenAfter: game.fen(),
        })
      }
    } catch {
      return false
    }
    setMoves((previous) => [...previous.slice(0, pointer), ...appended])
    setBoardTransition({ kind: 'direct' })
    setPointer(pointer + appended.length)
    return true
  }, [fen, pointer])

  return {
    fen,
    moves,
    pointer,
    legalMoves,
    boardTransition,
    isAtEnd: pointer === moves.length,
    goTo,
    goBack,
    goForward,
    makeMove,
    reset,
    loadLine,
    loadPosition,
    loadContinuationPath,
    snapshot,
    restoreSnapshot,
  }
}
