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
}

export type OpeningGenerationResult = {
  name: string
  color: RepertoireColor
  prefixUci: string[]
  leafCount: number
  pgn: string
  report: Record<string, unknown>
}

export function generateOpeningCandidate(
  request: OpeningGenerationRequest,
  signal?: AbortSignal,
): Promise<OpeningGenerationResult> {
  return apiRequest('/opening-templates/generate/', { method: 'POST', body: request, signal })
}
