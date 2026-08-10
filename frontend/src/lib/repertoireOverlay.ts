import type { RepertoireMove, RepertoireTree } from '../types'
import type { OpeningTemplateRelease } from './repertoireApi'

export function findMissingReleaseLines(
  lines: OpeningTemplateRelease['lines'],
  personalPaths: readonly string[],
): OpeningTemplateRelease['lines'] {
  return lines.filter((line) => {
    const path = line.steps.map((step) => step.uci).join(' ')
    return !personalPaths.some((owned) => owned === path || owned.startsWith(`${path} `))
  })
}

export type OverlayMove = RepertoireMove & { moduleIds: number[] }
export type RepertoireOverlayTree = Record<string, OverlayMove[]>

/**
 * Merges enabled module graphs in profile order. Identical position/move edges
 * appear once while retaining every contributing module id for later badges,
 * gap explanations, and safe module-scoped editing.
 */
export function mergeRepertoireTrees(
  modules: Array<{ moduleId: number; tree: RepertoireTree }>,
): RepertoireOverlayTree {
  const merged: RepertoireOverlayTree = {}
  for (const { moduleId, tree } of modules) {
    for (const [fen, moves] of Object.entries(tree)) {
      const existing = merged[fen] ?? []
      for (const move of moves) {
        const candidate = existing.find(
          (saved) => saved.uci === move.uci && saved.resultingFen === move.resultingFen,
        )
        if (candidate) {
          if (!candidate.moduleIds.includes(moduleId)) candidate.moduleIds.push(moduleId)
        } else {
          existing.push({ ...move, moduleIds: [moduleId] })
        }
      }
      merged[fen] = existing
    }
  }
  return merged
}
