import type { EngineEvaluation } from '../types'
import { ApiError, apiRequest } from './apiClient'
import { recordClientCacheMetric } from './cacheMetrics'
import { normalizeFen } from './chessUtils'

export const ENGINE_VERSION = 'stockfish-18-lite-single'
/** Human-readable engine identity derived from the same cache/build key. */
export const ENGINE_DISPLAY_NAME = `Stockfish ${ENGINE_VERSION.match(/^stockfish-(\d+)/)?.[1] ?? ENGINE_VERSION}`

type WireEvaluation = Omit<EngineEvaluation, 'thinking' | 'terminal'> & { engineVersion: string }

const memory = new Map<string, EngineEvaluation>()
const inFlight = new Map<string, Promise<EngineEvaluation>>()

function positionKey(fen: string): string {
  return `${ENGINE_VERSION}:${normalizeFen(fen)}`
}

export function rememberEngineEvaluation(evaluation: EngineEvaluation): void {
  if (evaluation.thinking) return
  const key = positionKey(evaluation.fen)
  const previous = memory.get(key)
  if (!previous || evaluation.depth >= previous.depth) memory.set(key, evaluation)
}

export function getRememberedEngineEvaluation(fen: string, minimumDepth = 0): EngineEvaluation | null {
  const cached = memory.get(positionKey(fen))
  if (!cached || cached.depth < minimumDepth) return null
  recordClientCacheMetric('engineMemoryHit')
  return { ...cached, fen }
}

export async function fetchCachedEngineEvaluation(fen: string): Promise<EngineEvaluation | null> {
  const params = new URLSearchParams({ fen, engineVersion: ENGINE_VERSION })
  try {
    const data = await apiRequest<WireEvaluation>(`/explorer/evals/?${params.toString()}`)
    const evaluation: EngineEvaluation = { ...data, fen, thinking: false }
    rememberEngineEvaluation(evaluation)
    recordClientCacheMetric('engineServerHit')
    return evaluation
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function persistEngineEvaluation(evaluation: EngineEvaluation): Promise<void> {
  if (evaluation.thinking || evaluation.terminal) return
  await apiRequest<WireEvaluation>('/explorer/evals/', {
    method: 'PUT',
    body: {
      fen: evaluation.fen,
      engineVersion: ENGINE_VERSION,
      depth: evaluation.depth,
      scoreType: evaluation.scoreType,
      scoreValue: evaluation.scoreValue,
      bestMoveUci: evaluation.bestMoveUci,
      pvUci: evaluation.pvUci,
    },
  })
}

export async function getOrComputeEngineEvaluation(
  fen: string,
  depth: number,
  signedIn: boolean,
  compute: () => Promise<EngineEvaluation>,
): Promise<EngineEvaluation> {
  const remembered = getRememberedEngineEvaluation(fen, depth)
  if (remembered) return remembered

  const requestKey = `${positionKey(fen)}:depth=${depth}`
  const existing = inFlight.get(requestKey)
  if (existing) return existing

  const request = (async () => {
    if (signedIn) {
      const server = await fetchCachedEngineEvaluation(fen).catch(() => null)
      if (server && server.depth >= depth) return server
    }
    recordClientCacheMetric('engineMiss')
    recordClientCacheMetric('engineAnalysisStarted')
    const evaluation = await compute()
    rememberEngineEvaluation(evaluation)
    recordClientCacheMetric('engineAnalysisCompleted')
    if (signedIn) void persistEngineEvaluation(evaluation).catch(() => undefined)
    return evaluation
  })().finally(() => inFlight.delete(requestKey))

  inFlight.set(requestKey, request)
  return request
}
