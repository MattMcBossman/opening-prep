import { apiRequest } from './apiClient'
import type { DrillOutcome } from './drillSessionLogic'

export type CreateDrillSessionResponse = { id: number; startedAt: string }

export function createDrillSession(repertoireId: number, isRetryPass: boolean): Promise<CreateDrillSessionResponse> {
  return apiRequest('/drills/sessions/', { method: 'POST', body: { repertoireId, isRetryPass } })
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
