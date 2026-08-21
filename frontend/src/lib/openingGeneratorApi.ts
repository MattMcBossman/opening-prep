import { apiRequest } from './apiClient'
import type { RepertoireColor } from '../types'

export type OpeningGenerationRequest = {
  name: string
  color: RepertoireColor
  prefix: string[]
  coverage: number
  maxLines: number
  maxPly: number
  minGames: number
  minFrequency: number
  maxOpponentReplies: number
  useEngine: boolean
  engineDepth: number
  maxEngineLossCp: number
  engineCandidates: number
  ratings?: string
  speeds?: string
  lichessToken?: string
  mode?: 'new_tree' | 'fill_gaps'
  existingLines?: string[][]
  moveBudget?: number
}

export type OpeningGenerationResult = {
  name: string
  color: RepertoireColor
  prefixUci: string[]
  leafCount: number
  pgn: string
  report: Record<string, unknown> & {
    engine?: string | null
    summary?: {
      positionsAnalyzed: number
      opponentPositions: number
      coverageTargetMet: number
      leafBudgetLimited: number
      replyLimitReached: number
      frequencyThresholdLimited: number
      noEligibleMoves: number
      minimumOpponentCoverage: number | null
      averageOpponentCoverage: number | null
      maximumGeneratedPly: number
    }
  }
  proposals?: Array<{
    id: string
    pathUci: string[]
    marginalCoverage: number
    moveGames: number
    newMoveCount: number
    exactTransposition: boolean
    similarityDistance: number | null
    score: number
  }>
}

export function generateOpeningCandidate(
  request: OpeningGenerationRequest,
  signal?: AbortSignal,
): Promise<OpeningGenerationResult> {
  return apiRequest('/opening-templates/generate/', { method: 'POST', body: request, signal })
}
