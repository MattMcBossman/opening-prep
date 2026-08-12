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
  const modules: LocalModule[] = []
  const links: LocalModuleLink[] = []
  const editingModuleIds: Partial<Record<RepertoireColor, number>> = {}
  for (const [color, id] of [['white', 2], ['black', 3]] as const) {
    const tree = repertoire[color]
    if (!Object.values(tree).some((moves) => moves.length > 0)) continue
    modules.push({ id, name: `Imported ${color === 'white' ? 'White' : 'Black'} module`, color, tree })
    links.push({ moduleId: id, enabled: true, sortOrder: links.length })
    editingModuleIds[color] = id
  }
  return {
    version: 3,
    nextId: 4,
    activeProfileId: 1,
    editingModuleIds,
    profiles: [{ id: 1, name: 'Default', modules: links }],
    modules,
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
    if (Array.isArray(candidate.profiles) && Array.isArray(candidate.modules)) {
      const removedIds = new Set<number>()
      const modules = candidate.modules.flatMap((module) => {
        if (module.name !== 'General White' && module.name !== 'General Black') return [module]
        if (!Object.values(module.tree).some((moves) => moves.length > 0)) {
          removedIds.add(module.id)
          return []
        }
        return [{ ...module, name: `Imported ${module.color === 'white' ? 'White' : 'Black'} module` }]
      })
      return {
        ...candidate,
        modules,
        profiles: candidate.profiles.map((profile) => ({
          ...profile,
          modules: profile.modules.filter((link) => !removedIds.has(link.moduleId)),
        })),
        editingModuleIds: Object.fromEntries(
          Object.entries(candidate.editingModuleIds).filter(([, id]) => id !== undefined && !removedIds.has(id)),
        ),
      }
    }
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
