import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { StockfishEngine } from '../engine/stockfishEngine'
import type { EngineEvaluation } from '../types'

const MAX_DEPTH = 20
// Last-resort safety net: a fresh evaluation should produce its first `info depth`
// line well within this window. If it doesn't (e.g. an unforeseen engine-side stall),
// tear down and recreate the engine instead of leaving the UI stuck indefinitely.
const WATCHDOG_TIMEOUT_MS = 8000
// Shallow depths can produce a burst of `info depth` lines within milliseconds, each
// restarting the eval bar's CSS transition and making it look jittery rather than
// smooth. Cap how often we actually push a new value into React state (the final,
// "done" update always flushes immediately regardless of this).
const UPDATE_THROTTLE_MS = 150

export function useEngineEval(fen: string) {
  const engineRef = useRef<StockfishEngine | null>(null)
  const [evaluation, setEvaluation] = useState<EngineEvaluation | null>(null)
  // Bumped whenever the engine is (re)created, so effects from a stale engine
  // instance can't act on state that no longer applies.
  const [engineGeneration, setEngineGeneration] = useState(0)

  // Each new FEN cancels the previous evaluate() call and starts a fresh
  // iterative-deepening search on the current engine instance.
  useEffect(() => {
    const engine = new StockfishEngine()
    engineRef.current = engine
    return () => engine.terminate()
  }, [engineGeneration])

  useEffect(() => {
    // A checkmated position has no legal moves for the engine to search, so `go` just
    // replies "bestmove (none)" — often with no preceding `info` line at all, or with
    // "score mate 0", whose sign is ambiguous once normalized (0 * ±1 is still 0). Either
    // way we'd end up displaying a decisive result as scoreValue 0 ("0.0", 50/50 bar).
    // Checkmate is unambiguous from the rules alone, so report it directly instead of
    // asking the engine.
    if (new Chess(fen).isCheckmate()) {
      const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w'
      setEvaluation({
        fen,
        depth: MAX_DEPTH,
        scoreType: 'mate',
        // The side to move has no moves and is in check, i.e. they're the one mated.
        scoreValue: sideToMove === 'w' ? -1 : 1,
        bestMoveUci: null,
        pvUci: [],
        thinking: false,
        terminal: true,
      })
      return
    }

    // Deliberately not resetting evaluation to null here: doing so made the eval bar
    // flash back to neutral (50/50) on every move, before the new search's first
    // result arrived. Keeping the previous value displayed until it's superseded
    // avoids that "bounce to zero" and is only ever briefly stale.
    let cancelled = false
    let stop: (() => void) | undefined
    let lastFlushedAt = 0
    let pendingUpdate: EngineEvaluation | undefined
    let pendingTimeout: ReturnType<typeof setTimeout> | undefined

    const watchdog = setTimeout(() => {
      if (!cancelled) {
        // No response from the engine in time — replace it rather than stay stuck.
        setEngineGeneration((n) => n + 1)
      }
    }, WATCHDOG_TIMEOUT_MS)

    const flush = (update: EngineEvaluation) => {
      lastFlushedAt = Date.now()
      pendingUpdate = undefined
      clearTimeout(watchdog)
      setEvaluation(update)
    }

    engineRef.current
      ?.evaluate(fen, {
        maxDepth: MAX_DEPTH,
        onUpdate: (update) => {
          if (cancelled) return

          // Always flush the final result immediately so it's never delayed.
          if (!update.thinking) {
            if (pendingTimeout) clearTimeout(pendingTimeout)
            pendingTimeout = undefined
            flush(update)
            return
          }

          const elapsed = Date.now() - lastFlushedAt
          if (elapsed >= UPDATE_THROTTLE_MS) {
            flush(update)
            return
          }

          pendingUpdate = update
          if (!pendingTimeout) {
            pendingTimeout = setTimeout(() => {
              pendingTimeout = undefined
              if (pendingUpdate) flush(pendingUpdate)
            }, UPDATE_THROTTLE_MS - elapsed)
          }
        },
      })
      .then((stopFn) => {
        stop = stopFn
      })

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      if (pendingTimeout) clearTimeout(pendingTimeout)
      stop?.()
    }
  }, [fen, engineGeneration])

  return evaluation
}
