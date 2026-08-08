import { useEffect, useState } from 'react'
import { fetchLichessExplorer } from '../lib/lichessExplorer'
import type { ExplorerResponse } from '../types'

export function useExplorerStats(fen: string, apiToken: string) {
  const [data, setData] = useState<ExplorerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!apiToken) {
      setData(null)
      setLoading(false)
      setError('Add a Lichess API token above to load explorer stats.')
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetchLichessExplorer(fen, apiToken, controller.signal)
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load explorer stats')
        setLoading(false)
      })

    return () => controller.abort()
  }, [fen, apiToken])

  return { data, loading, error }
}
