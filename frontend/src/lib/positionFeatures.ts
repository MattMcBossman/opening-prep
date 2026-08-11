import type { MoveFeatureComparison, PositionFeatureSet } from '../types'
import { apiRequest } from './apiClient'
import { normalizeFen } from './chessUtils'

const memory = new Map<string, PositionFeatureSet>()

export async function fetchPositionFeatures(fen: string, signal?: AbortSignal): Promise<PositionFeatureSet> {
  const normalized = normalizeFen(fen)
  const cached = memory.get(normalized)
  if (cached) return { ...cached, fen }
  const params = new URLSearchParams({ fen })
  const features = await apiRequest<PositionFeatureSet>(`/explorer/position-features/?${params}`, { signal })
  memory.set(normalized, features)
  return { ...features, fen }
}

export async function fetchMoveFeatureComparison(
  fen: string,
  move: string,
  signal?: AbortSignal,
): Promise<MoveFeatureComparison> {
  const params = new URLSearchParams({ fen, move })
  return apiRequest<MoveFeatureComparison>(`/explorer/move-comparisons/?${params}`, { signal })
}
