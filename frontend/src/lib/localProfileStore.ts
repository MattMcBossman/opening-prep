import { mergeRepertoireTrees } from './repertoireOverlay'
import type { Repertoire, RepertoireColor, RepertoireTree } from '../types'

export type LocalModule = { id: number; name: string; color: RepertoireColor; tree: RepertoireTree }
export type LocalModuleLink = { moduleId: number; enabled: boolean; sortOrder: number }
export type LocalProfile = { id: number; name: string; modules: LocalModuleLink[] }
export type LocalProfileStore = {
  version: 3
  nextId: number
  activeProfileId: number
  editingModuleIds: Partial<Record<RepertoireColor, number>>
  profiles: LocalProfile[]
  modules: LocalModule[]
}

export function defaultLocalProfileStore(repertoire: Repertoire = { white: {}, black: {} }): LocalProfileStore {
  return {
    version: 3,
    nextId: 4,
    activeProfileId: 1,
    editingModuleIds: { white: 2, black: 3 },
    profiles: [{ id: 1, name: 'Default', modules: [
      { moduleId: 2, enabled: true, sortOrder: 0 },
      { moduleId: 3, enabled: true, sortOrder: 1 },
    ] }],
    modules: [
      { id: 2, name: 'General White', color: 'white', tree: repertoire.white },
      { id: 3, name: 'General Black', color: 'black', tree: repertoire.black },
    ],
  }
}

function legacyRepertoire(value: unknown): Repertoire {
  if (!value || typeof value !== 'object') return { white: {}, black: {} }
  if ('version' in value && value.version === 2 && 'profiles' in value && Array.isArray(value.profiles)) {
    const profile = value.profiles[0]
    const modules: unknown[] = profile && typeof profile === 'object' && 'modules' in profile && Array.isArray(profile.modules)
      ? profile.modules : []
    const tree = (color: RepertoireColor) => {
      const module = modules.find((item) => item && typeof item === 'object' && 'color' in item && item.color === color)
      return module && typeof module === 'object' && 'tree' in module && module.tree && typeof module.tree === 'object'
        ? module.tree as RepertoireTree : {}
    }
    return { white: tree('white'), black: tree('black') }
  }
  const candidate = value as Partial<Repertoire>
  return { white: candidate.white ?? {}, black: candidate.black ?? {} }
}

export function parseLocalProfileStore(value: unknown): LocalProfileStore {
  if (value && typeof value === 'object' && 'version' in value && value.version === 3) {
    const candidate = value as LocalProfileStore
    if (Array.isArray(candidate.profiles) && Array.isArray(candidate.modules)) return candidate
  }
  return defaultLocalProfileStore(legacyRepertoire(value))
}

export function activeLocalRepertoire(store: LocalProfileStore): Repertoire {
  const profile = store.profiles.find((item) => item.id === store.activeProfileId) ?? store.profiles[0]
  const result: Repertoire = { white: {}, black: {} }
  for (const color of ['white', 'black'] as const) {
    const trees = (profile?.modules ?? [])
      .filter((link) => link.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .flatMap((link) => {
        const module = store.modules.find((item) => item.id === link.moduleId && item.color === color)
        return module ? [{ moduleId: module.id, tree: module.tree }] : []
      })
    result[color] = mergeRepertoireTrees(trees)
  }
  return result
}
