import type { ExplorerResponse, RepertoireColor } from '../types'
import type { LichessDatabaseFilters } from './lichessExplorer'

type Source = 'lichess' | 'chesscom'
let worker: Worker | null = null
let sequence = 0
let activeUserId = 0
let initialization: Promise<void> | null = null
const refreshedSources = new Set<string>()
const refreshes = new Map<string, Promise<number>>()
const refreshErrors = new Map<string, Error>()
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()
const progressListeners = new Set<() => void>()
const rateLimitUntil = new Map<string, number>()

function call<T>(message: Record<string, unknown>): Promise<T> {
  if (!worker) throw new Error('Personal-game index is not initialized.')
  const id = ++sequence
  worker.postMessage({ id, ...message })
  return new Promise((resolve, reject) => pending.set(id, { resolve: resolve as (value: unknown) => void, reject }))
}

export async function initializePersonalGamesIndex(userId: number): Promise<void> {
  if (worker && activeUserId === userId) return initialization ?? Promise.resolve()
  worker?.terminate()
  activeUserId = userId
  worker = new Worker(new URL('../workers/personalGamesIndex.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }: MessageEvent<{ id: number; data?: unknown; error?: string }>) => {
    const progress = data as { type?: string; source?: Source; retryDelaySeconds?: number }
    if (progress.type === 'rate-limited' && progress.source && progress.retryDelaySeconds) {
      rateLimitUntil.set(`${activeUserId}:${progress.source}`, Date.now() + progress.retryDelaySeconds * 1000)
      progressListeners.forEach((listener) => listener())
      return
    }
    if (progress.type === 'game-indexed' && progress.source) {
      rateLimitUntil.delete(`${activeUserId}:${progress.source}`)
      progressListeners.forEach((listener) => listener())
      return
    }
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.data)
  }
  initialization = call({ type: 'init', userId })
  await initialization
}

export function subscribeToPersonalGamesProgress(listener: () => void): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

export async function refreshPersonalGamesIndex(userId: number, sources: Source[]): Promise<number> {
  await initializePersonalGamesIndex(userId)
  const missing = sources.filter((source) => !refreshedSources.has(`${userId}:${source}`))
  if (!missing.length) return 0
  missing.forEach((source) => refreshErrors.delete(`${userId}:${source}`))
  const key = `${userId}:${missing.sort().join(',')}`
  const existing = refreshes.get(key)
  if (existing) return existing
  const refresh = call<number>({ type: 'refresh', sources: missing }).then((added) => {
    missing.forEach((source) => refreshedSources.add(`${userId}:${source}`))
    return added
  }).catch((reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error('Personal-game refresh failed.')
    missing.forEach((source) => {
      refreshErrors.set(`${userId}:${source}`, error)
    })
    progressListeners.forEach((listener) => listener())
    throw error
  }).finally(() => refreshes.delete(key))
  refreshes.set(key, refresh)
  return refresh
}

export function personalGamesRefreshInProgress(userId: number, sources: Source[]): boolean {
  return sources.some((source) => !refreshedSources.has(`${userId}:${source}`))
}

export function personalGamesRefreshError(userId: number, sources: Source[]): Error | null {
  return sources.map((source) => refreshErrors.get(`${userId}:${source}`)).find(Boolean) ?? null
}

export async function queryPersonalGamesIndex(
  userId: number,
  fen: string,
  color: RepertoireColor,
  filters?: LichessDatabaseFilters,
): Promise<ExplorerResponse> {
  await initializePersonalGamesIndex(userId)
  const result = await call<ExplorerResponse>({ type: 'query', fen, color, filters })
  const sources = filters?.databases ?? ['lichess', 'chesscom']
  const limitedSource = sources
    .map((source) => ({ source, retryAt: rateLimitUntil.get(`${userId}:${source}`) ?? 0 }))
    .find(({ retryAt }) => retryAt > Date.now())
  if (limitedSource) result.gameExportRateLimit = limitedSource
  return result
}
