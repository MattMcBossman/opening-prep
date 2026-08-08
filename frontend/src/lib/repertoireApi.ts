import { apiRequest } from './apiClient'
import type { Repertoire, RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

export type RepertoireSummary = {
  id: number
  name: string
  color: RepertoireColor
  moveCount: number
  createdAt: string
  updatedAt: string
}

/** One edge to add, as the `moves/` endpoint expects it - see API_CONTRACT.md. */
export type MoveEdge = RepertoireMove & { originFen: string }

export type ImportResult = { imported: number; skipped: number }
export type ImportSummary = { white: ImportResult; black: ImportResult }

export function listRepertoires(signal?: AbortSignal): Promise<RepertoireSummary[]> {
  return apiRequest('/repertoires/', { signal })
}

export function createRepertoire(color: RepertoireColor, name = 'Default'): Promise<RepertoireSummary> {
  return apiRequest('/repertoires/', { method: 'POST', body: { name, color } })
}

export function fetchRepertoireTree(id: number, signal?: AbortSignal): Promise<RepertoireTree> {
  return apiRequest(`/repertoires/${id}/tree/`, { signal })
}

/**
 * Adds one or more edges atomically in a single request - the server mirrors
 * the client's cascade-save (saving one move also saves every earlier ply in
 * the line), so callers should send the whole cascade as one batch rather than
 * one call per edge. Adding an edge that already exists is a no-op server-side.
 */
export function addRepertoireMoves(id: number, moves: MoveEdge[]): Promise<RepertoireTree> {
  return apiRequest(`/repertoires/${id}/moves/`, { method: 'POST', body: { moves } })
}

/** Applies the server-side cascade-delete (see API_CONTRACT.md) and returns the updated tree. */
export function removeRepertoireMove(id: number, originFen: string, uci: string): Promise<RepertoireTree> {
  return apiRequest(`/repertoires/${id}/moves/`, { method: 'DELETE', body: { originFen, uci } })
}

/** One-time migration of a localStorage repertoire; idempotent (existing edges are skipped, not duplicated). */
export function importRepertoire(local: Repertoire): Promise<ImportSummary> {
  return apiRequest('/repertoires/import/', { method: 'POST', body: local })
}

/**
 * Fetches (lazily creating, per API_CONTRACT.md) the one repertoire per color
 * and its full tree. Sequential rather than parallel: this only runs once per
 * sign-in, and keeping it simple avoids two concurrent `POST /repertoires/`
 * calls racing to create the same color's default repertoire.
 */
export async function ensureRepertoires(): Promise<Record<RepertoireColor, { id: number; tree: RepertoireTree }>> {
  const summaries = await listRepertoires()
  const byColor: Partial<Record<RepertoireColor, RepertoireSummary>> = {}
  for (const summary of summaries) {
    // If a color somehow has more than one repertoire, prefer the one named
    // "Default" (what the backend lazily creates - see API_CONTRACT.md); only a
    // single profile per color is used today (see AGENTS.md's deferred
    // "multiple repertoire profiles" item), so any other name is unexpected.
    const existing = byColor[summary.color]
    if (!existing || (existing.name !== 'Default' && summary.name === 'Default')) {
      byColor[summary.color] = summary
    }
  }

  const result = {} as Record<RepertoireColor, { id: number; tree: RepertoireTree }>
  for (const color of ['white', 'black'] as const) {
    const summary = byColor[color] ?? (await createRepertoire(color))
    const tree = await fetchRepertoireTree(summary.id)
    result[color] = { id: summary.id, tree }
  }
  return result
}
