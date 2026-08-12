import { apiRequest } from './apiClient'
import type { Repertoire, RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

export type RepertoireSummary = {
  id: number
  name: string
  description?: string
  color: RepertoireColor
  moveCount: number
  lineCount: number
  commonStart: string
  hasResponseConflicts?: boolean
  createdAt: string
  updatedAt: string
}

export type ProfileModuleSummary = {
  id: number
  name: string
  description: string
  color: RepertoireColor
  moveCount: number
  lineCount: number
  commonStart: string
  hasResponseConflicts?: boolean
  sortOrder: number
  enabled: boolean
}

export type RepertoireProfileSummary = {
  id: number
  name: string
  description: string
  modules: ProfileModuleSummary[]
  templateReleases?: ProfileTemplateReleaseSummary[]
  createdAt: string
  updatedAt: string
}

export type ProfileTemplateReleaseSummary = {
  id: number
  templateSlug: string
  name: string
  version: number
  color: RepertoireColor
  sortOrder: number
  enabled: boolean
}

export type OpeningTemplateSummary = {
  slug: string
  name: string
  description: string
  color: RepertoireColor
  kind: "official" | "community"
  publisherName: string
  latestRelease: { id: number; version: number; publishedAt: string; commonStart: string; lineCount: number } | null
}

export type OpeningTemplateRelease = {
  id: number
  templateSlug: string
  name: string
  changelog: string
  color: RepertoireColor
  version: number
  publishedAt: string
  commonStart: string
  lineCount: number
  tree: RepertoireTree
  lines: Array<{ id: string; label: string; source: string; sortOrder: number; steps: MoveEdge[] }>
}

/** One edge to add, as the `moves/` endpoint expects it - see API_CONTRACT.md. */
export type MoveEdge = RepertoireMove & { originFen: string }

export type RepertoireLine = {
  id: string
  lineKey: string
  uciPath: string
  label: string
  annotations: Array<{ ply: number; comment?: string; nags?: number[] }>
  source: 'manual' | 'pgn_import' | 'migrated'
  sortOrder: number
  steps: Array<MoveEdge & { ply: number }>
}

export type ImportResult = { imported: number; skipped: number }
export type ImportSummary = { white: ImportResult; black: ImportResult }

export function listRepertoires(signal?: AbortSignal): Promise<RepertoireSummary[]> {
  return apiRequest('/repertoires/', { signal })
}

export function createRepertoire(
  color: RepertoireColor,
  name = 'Default',
  description = '',
): Promise<RepertoireSummary> {
  return apiRequest('/repertoires/', {
    method: 'POST',
    body: { name, color, ...(description ? { description } : {}) },
  })
}

export function updateRepertoire(
  id: number,
  fields: { name?: string; description?: string },
): Promise<RepertoireSummary> {
  return apiRequest(`/repertoires/${id}/`, { method: 'PATCH', body: fields })
}

export function deleteRepertoire(id: number): Promise<void> {
  return apiRequest(`/repertoires/${id}/`, { method: 'DELETE' })
}

export function listRepertoireProfiles(signal?: AbortSignal): Promise<RepertoireProfileSummary[]> {
  return apiRequest('/repertoires/profiles/', { signal })
}

export function createRepertoireProfile(name: string, description = ''): Promise<RepertoireProfileSummary> {
  return apiRequest('/repertoires/profiles/', { method: 'POST', body: { name, description } })
}

export function updateRepertoireProfile(
  id: number,
  fields: { name?: string; description?: string },
): Promise<RepertoireProfileSummary> {
  return apiRequest(`/repertoires/profiles/${id}/`, { method: 'PATCH', body: fields })
}

export function deleteRepertoireProfile(id: number): Promise<void> {
  return apiRequest(`/repertoires/profiles/${id}/`, { method: 'DELETE' })
}

export function setProfileModule(
  profileId: number,
  moduleId: number,
  sortOrder: number,
  enabled = true,
): Promise<RepertoireProfileSummary> {
  return apiRequest(`/repertoires/profiles/${profileId}/modules/`, {
    method: 'POST',
    body: { moduleId, sortOrder, enabled },
  })
}

export function removeProfileModule(profileId: number, moduleId: number): Promise<RepertoireProfileSummary> {
  return apiRequest(`/repertoires/profiles/${profileId}/modules/`, {
    method: 'DELETE',
    body: { moduleId },
  })
}

export function publishOpeningTemplate(moduleId: number, changelog = ""): Promise<OpeningTemplateSummary> {
  return apiRequest("/opening-templates/publish/", { method: "POST", body: { moduleId, changelog } })
}

export function listOpeningTemplates(signal?: AbortSignal): Promise<OpeningTemplateSummary[]> {
  return apiRequest('/opening-templates/', { signal })
}

export function fetchOpeningTemplateRelease(
  slug: string,
  version: number,
  signal?: AbortSignal,
): Promise<OpeningTemplateRelease> {
  return apiRequest(`/opening-templates/${encodeURIComponent(slug)}/releases/${version}/`, { signal })
}

export function pinTemplateRelease(
  profileId: number,
  releaseId: number,
  sortOrder = 0,
  enabled = true,
): Promise<RepertoireProfileSummary> {
  return apiRequest(`/repertoires/profiles/${profileId}/template-releases/`, {
    method: 'POST',
    body: { templateReleaseId: releaseId, sortOrder, enabled },
  })
}

export function unpinTemplateRelease(profileId: number, releaseId: number): Promise<RepertoireProfileSummary> {
  return apiRequest(`/repertoires/profiles/${profileId}/template-releases/`, {
    method: 'DELETE',
    body: { templateReleaseId: releaseId },
  })
}

export function copyOpeningTemplateRelease(
  slug: string,
  version: number,
  profileId?: number,
): Promise<RepertoireSummary> {
  return apiRequest(`/opening-templates/${encodeURIComponent(slug)}/releases/${version}/copy/`, {
    method: 'POST',
    body: profileId === undefined ? {} : { profileId },
  })
}

export function copyMissingOpeningTemplateLines(
  slug: string,
  version: number,
  moduleId: number,
): Promise<{ added: number; skipped: number }> {
  return apiRequest(`/opening-templates/${encodeURIComponent(slug)}/releases/${version}/copy-missing/`, {
    method: 'POST',
    body: { moduleId },
  })
}

export function fetchRepertoireTree(id: number, signal?: AbortSignal): Promise<RepertoireTree> {
  return apiRequest(`/repertoires/${id}/tree/`, { signal })
}

export function listRepertoireLines(id: number, signal?: AbortSignal): Promise<RepertoireLine[]> {
  return apiRequest(`/repertoires/${id}/lines/`, { signal })
}

export function addRepertoireLine(
  id: number,
  steps: MoveEdge[],
  label = '',
  source: RepertoireLine['source'] = 'manual',
  annotations: RepertoireLine['annotations'] = [],
  conflictPolicy: 'reject' | 'replace' = 'reject',
): Promise<RepertoireLine[]> {
  return apiRequest(`/repertoires/${id}/lines/`, {
    method: 'POST',
    body: { label, source, annotations, steps, conflictPolicy },
  })
}

export function deleteRepertoireLine(id: number, lineId: string): Promise<void> {
  return apiRequest(`/repertoires/${id}/lines/${lineId}/`, { method: 'DELETE' })
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
