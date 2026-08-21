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
  requestedCoverage?: number
  minimumScore?: number
  evaluationWeight?: number
  minimumEvaluation?: number
  progressId?: string
}

export type OpeningGenerationProgress = {
  phase: string
  message: string
  current: number | null
  total: number | null
  retryAtMs: number | null
  suggestions: OpeningGenerationProposal[]
  activeLineUci: string[]
  activeBasePly: number
}

export type OpeningGenerationProposal = {
  id: string
  pathUci: string[]
  marginalCoverage: number
  moveGames: number
  newMoveCount: number
  exactTransposition: boolean
  similarityDistance: number | null
  score: number
  depth: number
  gapMissingRate: number
  kind: 'response' | 'terminal'
  basePly: number
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
  proposals?: OpeningGenerationProposal[]
}

export function generateOpeningCandidate(
  request: OpeningGenerationRequest,
  signal?: AbortSignal,
  onProgress?: (progress: OpeningGenerationProgress) => void,
): Promise<OpeningGenerationResult> {
  const progressId = request.progressId ?? crypto.randomUUID()
  let stopped = false
  let nextPollDelay = 1000
  const poll = async () => {
    while (!stopped && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, nextPollDelay))
      if (stopped || signal?.aborted) return
      try {
        const progress = await apiRequest<OpeningGenerationProgress>(`/opening-templates/generate-progress/${progressId}/`, { signal })
        onProgress?.(progress)
        nextPollDelay = progress.retryAtMs
          ? Math.max(1000, progress.retryAtMs - Date.now() + 250)
          : 1000
      } catch {
        // The POST and first poll can race; the next poll will pick up progress.
      }
    }
  }
  void poll()
  return apiRequest<OpeningGenerationResult>('/opening-templates/generate/', {
    method: 'POST', body: { ...request, progressId }, signal,
  }).finally(() => { stopped = true })
}
