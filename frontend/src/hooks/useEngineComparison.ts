import { useCallback, useEffect, useRef } from 'react'
import { StockfishEngine } from '../engine/stockfishEngine'
import { BAD_MOVE_CP_THRESHOLD, classifyMoveQuality } from '../lib/moveQuality'
import type { EngineEvaluation, RepertoireColor } from '../types'

// Comparisons don't need the same depth as the live explorer eval - a moderate
// fixed depth is enough to reliably tell "off-book but fine" from "objectively bad"
// while staying fast for an immediate feedback loop.
const COMPARISON_DEPTH = 14

export type MoveComparisonResult = {
  cpLoss: number
  isBad: boolean
  /** The engine's best line *from the resulting position* - i.e. how the played
   * move would be punished. Only meaningful to show the user when `isBad`. */
  bestResponseLine: EngineEvaluation
}

/**
 * Provides one-shot (non-streaming) before/after evaluation for classifying a
 * drill wrong-move, using a dedicated StockfishEngine instance so it never
 * contends with the explorer's live evaluation (see useEngineEval). Requests on
 * a single engine instance are serialized (see StockfishEngine), so the two
 * evaluations for one comparison are always run one after another, never
 * concurrently. Results are cached in memory for the lifetime of this hook so
 * retrying the same mistake at the same position doesn't restart engine work.
 */
export function useEngineComparison() {
  const engineRef = useRef<StockfishEngine | null>(null)
  const cacheRef = useRef(new Map<string, Promise<MoveComparisonResult>>())
  const evalCacheRef = useRef(new Map<string, Promise<EngineEvaluation>>())

  useEffect(() => {
    return () => {
      engineRef.current?.terminate()
      engineRef.current = null
    }
  }, [])

  const compare = useCallback(
    (
      originFen: string,
      resultingFen: string,
      mover: RepertoireColor,
      threshold: number = BAD_MOVE_CP_THRESHOLD,
    ): Promise<MoveComparisonResult> => {
      const key = `${originFen}|${resultingFen}|${mover}|${threshold}`
      const cached = cacheRef.current.get(key)
      if (cached) return cached

      if (!engineRef.current) engineRef.current = new StockfishEngine()
      const engine = engineRef.current

      const promise = (async () => {
        const before = await engine.evaluateOnce(originFen, COMPARISON_DEPTH)
        const after = await engine.evaluateOnce(resultingFen, COMPARISON_DEPTH)
        const quality = classifyMoveQuality(before, after, mover, threshold)
        return { ...quality, bestResponseLine: after }
      })()

      cacheRef.current.set(key, promise)
      return promise
    },
    [],
  )

  /**
   * A plain one-shot evaluation of a single position - used to show the
   * opponent's best untried response after a drill line completes, rather than
   * comparing a before/after pair. Shares the same engine instance and a
   * separate cache keyed by FEN.
   */
  const evaluatePosition = useCallback((fen: string, depth: number = COMPARISON_DEPTH): Promise<EngineEvaluation> => {
    const cached = evalCacheRef.current.get(fen)
    if (cached) return cached

    if (!engineRef.current) engineRef.current = new StockfishEngine()
    const promise = engineRef.current.evaluateOnce(fen, depth)
    evalCacheRef.current.set(fen, promise)
    return promise
  }, [])

  return { compare, evaluatePosition }
}
