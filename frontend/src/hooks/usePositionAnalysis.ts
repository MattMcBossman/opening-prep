import { useEffect, useRef, useState } from 'react'
import { StockfishEngine } from '../engine/stockfishEngine'
import { getOrComputePositionAnalysis } from '../lib/positionAnalysis'
import type { PositionAnalysis } from '../types'

export function usePositionAnalysis(fen: string, enabled: boolean, signedIn: boolean) {
  const engineRef = useRef<StockfishEngine | null>(null)
  const [analysis, setAnalysis] = useState<PositionAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => engineRef.current?.terminate(), [])

  useEffect(() => {
    if (!enabled || !fen) {
      setLoading(false)
      setError(null)
      return
    }
    if (!engineRef.current) engineRef.current = new StockfishEngine()
    let cancelled = false
    setLoading(true)
    setError(null)
    void getOrComputePositionAnalysis(fen, signedIn, engineRef.current, (cached) => {
      if (!cancelled) setAnalysis(cached)
    }).then(
      (result) => {
        if (!cancelled) {
          setAnalysis(result)
          setLoading(false)
        }
      },
      (reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Position analysis failed.')
          setLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [fen, enabled, signedIn])

  return { analysis, loading, error }
}
