import { useEffect, useState } from 'react'
import type { MoveFeatureComparison } from '../types'
import { fetchMoveFeatureComparison } from '../lib/positionFeatures'

export function useMoveFeatureComparison(fen: string, move: string, enabled: boolean) {
  const [comparison, setComparison] = useState<MoveFeatureComparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !fen || !move) {
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void fetchMoveFeatureComparison(fen, move, controller.signal).then(
      (result) => {
        setComparison(result)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Position comparison is unavailable.')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [enabled, fen, move])

  return { comparison, loading, error }
}
