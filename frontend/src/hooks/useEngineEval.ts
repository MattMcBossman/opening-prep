import { useEffect, useRef, useState } from 'react'
import { StockfishEngine } from '../engine/stockfishEngine'
import type { EngineEvaluation } from '../types'

const MAX_DEPTH = 20
// Last-resort safety net: a fresh evaluation should produce its first `info depth`
// line well within this window. If it doesn't (e.g. an unforeseen engine-side stall),
// tear down and recreate the engine instead of leaving the UI stuck indefinitely.
const WATCHDOG_TIMEOUT_MS = 8000

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
    setEvaluation(null)
    let cancelled = false
    let stop: (() => void) | undefined

    const watchdog = setTimeout(() => {
      if (!cancelled) {
        // No response from the engine in time — replace it rather than stay stuck.
        setEngineGeneration((n) => n + 1)
      }
    }, WATCHDOG_TIMEOUT_MS)

    engineRef.current
      ?.evaluate(fen, {
        maxDepth: MAX_DEPTH,
        onUpdate: (update) => {
          if (cancelled) return
          clearTimeout(watchdog)
          setEvaluation(update)
        },
      })
      .then((stopFn) => {
        stop = stopFn
      })

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      stop?.()
    }
  }, [fen, engineGeneration])

  return evaluation
}
