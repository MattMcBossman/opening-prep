import { useEffect, useState } from 'react'
import type { PositionFeatureSet } from '../types'
import { fetchPositionFeatures } from '../lib/positionFeatures'

export function usePositionFeatures(fen: string, enabled: boolean) {
  const [features, setFeatures] = useState<PositionFeatureSet | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !fen) {
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void fetchPositionFeatures(fen, controller.signal).then(
      (result) => {
        setFeatures(result)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Concrete board facts are unavailable.')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [enabled, fen])

  return { features, loading, error }
}
