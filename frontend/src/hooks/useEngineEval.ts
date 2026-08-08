import { useEffect, useRef, useState } from 'react'
import { StockfishEngine } from '../engine/stockfishEngine'
import type { EngineEvaluation } from '../types'

const MAX_DEPTH = 20

export function useEngineEval(fen: string) {
  const engineRef = useRef<StockfishEngine | null>(null)
  const [evaluation, setEvaluation] = useState<EngineEvaluation | null>(null)

  // One engine instance for the lifetime of the component; each new FEN cancels
  // the previous evaluate() call and starts a fresh iterative-deepening search.
  useEffect(() => {
    const engine = new StockfishEngine()
    engineRef.current = engine
    return () => engine.terminate()
  }, [])

  useEffect(() => {
    setEvaluation(null)
    let cancelled = false
    let stop: (() => void) | undefined

    engineRef.current
      ?.evaluate(fen, {
        maxDepth: MAX_DEPTH,
        onUpdate: (update) => {
          if (!cancelled) setEvaluation(update)
        },
      })
      .then((stopFn) => {
        stop = stopFn
      })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [fen])

  return evaluation
}
