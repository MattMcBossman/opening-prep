import { apiRequest } from './apiClient'
import type { DrillOutcome } from './drillSessionLogic'

export type CreateDrillSessionResponse = { id: number; startedAt: string }

export type CreateDrillSessionPayload = {
  repertoireIds: number[]
  templateReleaseIds?: number[]
  isRetryPass: boolean
  startMode?: 'beginning' | 'selected_position'
  selectedFen?: string | null
  selectedPly?: number | null
  prefixUci?: string[]
}

export function createDrillSession(
  repertoireIdOrPayload: number | CreateDrillSessionPayload,
  legacyIsRetryPass?: boolean,
): Promise<CreateDrillSessionResponse> {
  const body = typeof repertoireIdOrPayload === 'number'
    ? { repertoireId: repertoireIdOrPayload, isRetryPass: legacyIsRetryPass ?? false }
    : {
        templateReleaseIds: [],
        startMode: 'beginning',
        selectedFen: null,
        selectedPly: null,
        prefixUci: [],
        ...repertoireIdOrPayload,
      }
  return apiRequest('/drills/sessions/', { method: 'POST', body })
}

export type DrillAttemptPayload = {
  originFen: string
  playedUci: string
  isCorrect: boolean
  attemptNumber: number
  lineId: string
  /** Only present once the (async) engine comparison resolves, and never for a correct move. */
  cpLoss?: number
  isBad?: boolean
}

export function submitDrillAttempts(sessionId: number, attempts: DrillAttemptPayload[]): Promise<void> {
  return apiRequest(`/drills/sessions/${sessionId}/attempts/`, { method: 'POST', body: { attempts } })
}

export type DrillLineOutcome = { lineId: string; outcome: DrillOutcome }

export function finishDrillSession(sessionId: number, results: DrillLineOutcome[]): Promise<unknown> {
  return apiRequest(`/drills/sessions/${sessionId}/finish/`, { method: 'POST', body: { results } })
}
