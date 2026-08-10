import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { fetchExplorerStats } from '../lib/lichessExplorer'
import { canonicalArrowUci, combinePlayerFollowups, commonContinuations } from '../lib/drillPositionAssessment'
import type { ExplorerResponse } from '../types'

type FollowupBranch = {
  immediateGames: number
  san: string
  stats: ExplorerResponse
}

/** Loads player replies after each of the three most common immediate moves. */
export function useDrillFollowupStats(
  fen: string,
  immediateStats: ExplorerResponse | null,
  apiToken: string,
  signedIn: boolean,
  enabled: boolean,
) {
  const [branches, setBranches] = useState<FollowupBranch[]>([])
  const immediateMoves = useMemo(
    () => commonContinuations(immediateStats, null, 3),
    [immediateStats],
  )
  const movesKey = immediateMoves.map((move) => `${move.uci}:${move.totalGames}`).join('|')

  useEffect(() => {
    setBranches([])
    if (!enabled || !fen || immediateMoves.length === 0) return

    const controller = new AbortController()
    Promise.all(immediateMoves.map(async (move): Promise<FollowupBranch | null> => {
      const game = new Chess(fen)
      const uci = canonicalArrowUci(move.uci)
      try {
        const played = game.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.slice(4) || undefined,
        })
        if (!played) return null
        const stats = await fetchExplorerStats(game.fen(), { apiToken, signedIn, signal: controller.signal })
        return { immediateGames: move.totalGames, san: played.san, stats }
      } catch {
        return null
      }
    })).then((results) => {
      if (!controller.signal.aborted) setBranches(results.filter((branch): branch is FollowupBranch => branch !== null))
    })
    return () => controller.abort()
    // movesKey captures the stable identity of immediateMoves without making
    // this request effect depend on the freshly allocated array itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken, enabled, fen, movesKey, signedIn])

  return {
    data: combinePlayerFollowups(branches),
    afterSans: branches.map((branch) => branch.san),
  }
}
