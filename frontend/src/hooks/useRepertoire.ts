import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeFen, sideToMove } from '../lib/chessUtils'
import { addMoveToTree, isRepertoireEmpty, removeMoveFromTree } from '../lib/repertoireTree'
import { mergeRepertoireTrees } from '../lib/repertoireOverlay'
import { activeLocalRepertoire, defaultLocalProfileStore, parseLocalProfileStore } from '../lib/localProfileStore'
import type { LocalProfileStore } from '../lib/localProfileStore'
import {
  addRepertoireMoves,
  addRepertoireLine,
  copyOpeningTemplateRelease,
  copyMissingOpeningTemplateLines,
  createRepertoire,
  createRepertoireProfile,
  deleteRepertoire,
  deleteRepertoireProfile,
  ensureRepertoires,
  fetchOpeningTemplateRelease,
  fetchRepertoireTree,
  importRepertoire,
  listRepertoireProfiles,
  listRepertoireLines,
  listRepertoires,
  pinTemplateRelease,
  removeRepertoireMove,
  removeProfileModule,
  setProfileModule,
  unpinTemplateRelease,
  updateRepertoire,
  updateRepertoireProfile,
} from '../lib/repertoireApi'
import type {
  ImportSummary,
  MoveEdge,
  OpeningTemplateRelease,
  RepertoireLine as ApiRepertoireLine,
  RepertoireProfileSummary,
  RepertoireSummary,
} from '../lib/repertoireApi'
import type { AuthUser } from '../lib/authApi'
import { collectDrillLines } from '../lib/repertoireDrills'
import type { DrillLine } from '../lib/repertoireDrills'
import type { Repertoire, RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

const STORAGE_KEY = 'opening-prep:repertoire'
const STORAGE_V1_BACKUP_KEY = 'opening-prep:repertoire:v1-backup'
const IMPORT_STATUS_KEY_PREFIX = 'opening-prep:repertoire-import-status:'

function emptyRepertoire(): Repertoire {
  return { white: {}, black: {} }
}

type LocalRepertoireV2 = {
  version: 2
  activeProfileId: 'default'
  profiles: Array<{
    id: 'default'
    name: 'Default'
    modules: Array<{ id: 'general-white' | 'general-black'; name: string; color: RepertoireColor; tree: RepertoireTree }>
  }>
}

export function serializeLocalRepertoireV2(repertoire: Repertoire): LocalRepertoireV2 {
  return {
    version: 2,
    activeProfileId: 'default',
    profiles: [
      {
        id: 'default',
        name: 'Default',
        modules: [
          { id: 'general-white', name: 'General White', color: 'white', tree: repertoire.white },
          { id: 'general-black', name: 'General Black', color: 'black', tree: repertoire.black },
        ],
      },
    ],
  }
}

export function parseLocalRepertoire(parsed: unknown): Repertoire {
  const merged = activeLocalRepertoire(parseLocalProfileStore(parsed))
  return Object.fromEntries(
    (['white', 'black'] as const).map((color) => [
      color,
      Object.fromEntries(Object.entries(merged[color]).map(([fen, moves]) => [
        fen,
        moves.map(({ san, uci, resultingFen }) => ({ san, uci, resultingFen })),
      ])),
    ]),
  ) as Repertoire
}

function loadLocalProfileData(): LocalProfileStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultLocalProfileStore()
    const parsed: unknown = JSON.parse(raw)
    const store = parseLocalProfileStore(parsed)
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 3) {
      localStorage.setItem(STORAGE_V1_BACKUP_KEY, raw)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    }
    return store
  } catch {
    return defaultLocalProfileStore()
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.'
}

/**
 * Client-side (localStorage-only) store for the anonymous user's repertoire -
 * exactly Phase 2's behaviour (see AGENTS.md), just factored through the
 * shared `repertoireTree` cascade logic so `useApiRepertoireStore` below can
 * reuse the exact same rules for its optimistic updates. This stays the only
 * store for anonymous use, and is also what the one-time import prompt reads
 * the local data from.
 */
function useLocalRepertoireStore() {
  const [store, setStore] = useState<LocalProfileStore>(loadLocalProfileData)
  const repertoire = useMemo(() => activeLocalRepertoire(store), [store])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch {
      // Best-effort persistence only.
    }
  }, [store])

  const editingModule = useCallback((state: LocalProfileStore, color: RepertoireColor) => {
    const id = state.editingModuleIds[color]
    return state.modules.find((module) => module.id === id && module.color === color)
  }, [])

  const getContinuations = useCallback(
    (color: RepertoireColor, fen: string): RepertoireMove[] => repertoire[color][normalizeFen(fen)] ?? [],
    [repertoire],
  )

  const isMoveSaved = useCallback(
    (color: RepertoireColor, fen: string, uci: string): boolean => {
      const module = editingModule(store, color)
      return (module?.tree[normalizeFen(fen)] ?? []).some((move) => move.uci === uci)
    },
    [editingModule, store],
  )

  const addMove = useCallback((color: RepertoireColor, fen: string, move: RepertoireMove) => {
    setStore((previous) => {
      const target = editingModule(previous, color)
      if (!target) return previous
      const tree = addMoveToTree(target.tree, fen, move)
      if (tree === target.tree) return previous
      return { ...previous, modules: previous.modules.map((module) => module.id === target.id ? { ...module, tree } : module) }
    })
  }, [editingModule])

  const removeMove = useCallback((color: RepertoireColor, fen: string, uci: string) => {
    setStore((previous) => {
      const target = editingModule(previous, color)
      if (!target) return previous
      const tree = removeMoveFromTree(target.tree, color, fen, uci)
      if (tree === target.tree) return previous
      return { ...previous, modules: previous.modules.map((module) => module.id === target.id ? { ...module, tree } : module) }
    })
  }, [editingModule])

  const modules: RepertoireSummary[] = store.modules.map((module) => ({
    id: module.id, name: module.name, description: '', color: module.color,
    moveCount: Object.values(module.tree).reduce((sum, moves) => sum + moves.length, 0),
    lineCount: collectDrillLines(module.color, (fen) => module.tree[normalizeFen(fen)] ?? []).length,
    createdAt: '', updatedAt: '',
  }))
  const profiles: RepertoireProfileSummary[] = store.profiles.map((profile) => ({
    id: profile.id, name: profile.name, description: '', createdAt: '', updatedAt: '',
    modules: profile.modules.flatMap((link) => {
      const module = modules.find((candidate) => candidate.id === link.moduleId)
      return module ? [{
        id: module.id,
        name: module.name,
        description: module.description ?? '',
        color: module.color,
        moveCount: module.moveCount,
        lineCount: module.lineCount,
        enabled: link.enabled,
        sortOrder: link.sortOrder,
      }] : []
    }),
    templateReleases: [],
  }))
  const activeProfile = profiles.find((profile) => profile.id === store.activeProfileId) ?? profiles[0] ?? null
  const allocate = (state: LocalProfileStore) => [state.nextId, { ...state, nextId: state.nextId + 1 }] as const
  const resolved = async <T,>(value: T) => value
  const editingForProfile = (state: LocalProfileStore, profileId: number) => {
    const profile = state.profiles.find((item) => item.id === profileId)
    const ids: Partial<Record<RepertoireColor, number>> = {}
    for (const color of ['white', 'black'] as const) {
      ids[color] = profile?.modules
        .filter((link) => link.enabled)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((link) => state.modules.find((module) => module.id === link.moduleId))
        .find((module) => module?.color === color)?.id
    }
    return ids
  }

  return {
    repertoire, getContinuations, isMoveSaved, addMove, removeMove, profiles, modules, activeProfile,
    activeProfileId: activeProfile?.id ?? null, editingModuleIds: store.editingModuleIds,
    setActiveProfile: (profileId: number) => setStore((previous) => {
      const profile = previous.profiles.find((item) => item.id === profileId)
      if (!profile) return previous
      const editingModuleIds: Partial<Record<RepertoireColor, number>> = {}
      for (const color of ['white', 'black'] as const) {
        editingModuleIds[color] = profile.modules
          .filter((link) => link.enabled)
          .map((link) => previous.modules.find((module) => module.id === link.moduleId))
          .find((module) => module?.color === color)?.id
      }
      return { ...previous, activeProfileId: profileId, editingModuleIds }
    }),
    setEditingModule: (color: RepertoireColor, moduleId: number) => setStore((previous) => ({
      ...previous, editingModuleIds: { ...previous.editingModuleIds, [color]: moduleId },
    })),
    createProfile: (name: string) => resolved(setStore((previous) => {
      const [id, next] = allocate(previous)
      return { ...next, profiles: [...next.profiles, { id, name, modules: [] }], activeProfileId: id, editingModuleIds: {} }
    })),
    renameProfile: (id: number, name: string) => resolved(setStore((previous) => ({ ...previous, profiles: previous.profiles.map((profile) => profile.id === id ? { ...profile, name } : profile) }))),
    deleteProfile: (id: number) => resolved(setStore((previous) => {
      if (previous.profiles.length <= 1) return previous
      const profiles = previous.profiles.filter((profile) => profile.id !== id)
      const next = { ...previous, profiles, activeProfileId: profiles[0].id }
      return { ...next, editingModuleIds: editingForProfile(next, next.activeProfileId) }
    })),
    createModule: (color: RepertoireColor, name: string, _description = '', profileId?: number) => resolved(setStore((previous) => {
      const [id, next] = allocate(previous)
      const profiles = next.profiles.map((profile) => profile.id === profileId
        ? { ...profile, modules: [...profile.modules, { moduleId: id, enabled: true, sortOrder: profile.modules.length }] }
        : profile)
      return { ...next, profiles, modules: [...next.modules, { id, name, color, tree: {} }], editingModuleIds: { ...next.editingModuleIds, [color]: id } }
    })),
    renameModule: (id: number, name: string) => resolved(setStore((previous) => ({ ...previous, modules: previous.modules.map((module) => module.id === id ? { ...module, name } : module) }))),
    deleteModule: (id: number) => resolved(setStore((previous) => {
      const next = { ...previous, modules: previous.modules.filter((module) => module.id !== id), profiles: previous.profiles.map((profile) => ({ ...profile, modules: profile.modules.filter((link) => link.moduleId !== id) })) }
      return { ...next, editingModuleIds: editingForProfile(next, next.activeProfileId) }
    })),
    setModuleMembership: (profileId: number, moduleId: number, sortOrder: number, enabled: boolean) => resolved(setStore((previous) => ({ ...previous, profiles: previous.profiles.map((profile) => {
      if (profile.id !== profileId) return profile
      const exists = profile.modules.some((link) => link.moduleId === moduleId)
      return { ...profile, modules: exists ? profile.modules.map((link) => link.moduleId === moduleId ? { ...link, sortOrder, enabled } : link) : [...profile.modules, { moduleId, sortOrder, enabled }] }
    }) }))),
    removeModuleMembership: (profileId: number, moduleId: number) => resolved(setStore((previous) => {
      const next = { ...previous, profiles: previous.profiles.map((profile) => profile.id === profileId ? { ...profile, modules: profile.modules.filter((link) => link.moduleId !== moduleId) } : profile) }
      return profileId === next.activeProfileId ? { ...next, editingModuleIds: editingForProfile(next, profileId) } : next
    })),
  }
}

type ApiStoreStatus = 'idle' | 'loading' | 'ready' | 'error'

type ApiStoreState = {
  status: ApiStoreStatus
  profiles: RepertoireProfileSummary[]
  modules: RepertoireSummary[]
  trees: Record<number, RepertoireTree>
  lines: Record<number, ApiRepertoireLine[]>
  templateTrees: Record<number, RepertoireTree>
  templateReleases: Record<number, OpeningTemplateRelease>
  activeProfileId: number | null
  editingModuleIds: Partial<Record<RepertoireColor, number>>
  error: string | null
  errorKind: 'load' | 'change' | null
}

const INITIAL_API_STATE: ApiStoreState = {
  status: 'idle',
  profiles: [],
  modules: [],
  trees: {},
  lines: {},
  templateTrees: {},
  templateReleases: {},
  activeProfileId: null,
  editingModuleIds: {},
  error: null,
  errorKind: null,
}

/**
 * Backend-backed store, active only while signed in. Mutations are applied
 * optimistically (via the same `repertoireTree` cascade logic the local store
 * uses) so the UI never waits on a round trip, then reconciled with the
 * server's canonical tree. A failed mutation re-fetches that color's tree from
 * the server rather than hand-computing an inverse patch, which would be
 * fragile if another batched add interleaved with it (see `flushAdds`) - the
 * goal is just "never leave the UI lying about what's saved", not a perfect
 * undo.
 */
function useApiRepertoireStore(enabled: boolean) {
  const [state, setState] = useState<ApiStoreState>(INITIAL_API_STATE)
  const [previewRelease, setPreviewRelease] = useState<OpeningTemplateRelease | null>(null)
  const editingIdsRef = useRef(state.editingModuleIds)
  useEffect(() => {
    editingIdsRef.current = state.editingModuleIds
  }, [state.editingModuleIds])

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null, errorKind: null }))
    return ensureRepertoires()
      .then(async (defaults) => {
        const [profiles, modules] = await Promise.all([listRepertoireProfiles(), listRepertoires()])
        const modulePayloads = await Promise.all(
          modules.map(async (module) => ({
            id: module.id,
            tree: await fetchRepertoireTree(module.id),
            lines: await listRepertoireLines(module.id),
          })),
        )
        const trees = Object.fromEntries(modulePayloads.map((payload) => [payload.id, payload.tree]))
        const lines = Object.fromEntries(modulePayloads.map((payload) => [payload.id, payload.lines]))
        // Older/still-running backend processes may omit the newly added
        // top-level lineCount. We already load canonical authored lines for
        // every module, so hydrate the count from those instead of letting the
        // management UI render an empty value.
        const hydratedModules = modules.map((module) => ({
          ...module,
          lineCount: Number.isFinite(module.lineCount) ? module.lineCount : (lines[module.id]?.length ?? 0),
        }))
        const pinnedReleases = profiles.flatMap((profile) => profile.templateReleases ?? [])
        const fetchedReleases = await Promise.all(
            Array.from(new Map(pinnedReleases.map((release) => [release.id, release])).values()).map(
              (release) => fetchOpeningTemplateRelease(release.templateSlug, release.version),
            ),
        )
        const templateReleases = Object.fromEntries(fetchedReleases.map((release) => [release.id, release]))
        const templateTrees = Object.fromEntries(fetchedReleases.map((release) => [release.id, release.tree]))
        setState((previous) => {
          const activeProfile =
            profiles.find((profile) => profile.id === previous.activeProfileId) ??
            profiles.find((profile) => profile.name === 'Default') ??
            profiles[0] ??
            null
          const editingModuleIds: Partial<Record<RepertoireColor, number>> = {}
          for (const color of ['white', 'black'] as const) {
            const activeModules = activeProfile?.modules.filter((module) => module.enabled && module.color === color) ?? []
            const previousId = previous.editingModuleIds[color]
            editingModuleIds[color] =
              activeModules.find((module) => module.id === previousId)?.id ??
              activeModules[0]?.id ??
              (activeProfile ? undefined : defaults[color].id)
          }
          return {
            status: 'ready',
            profiles,
            modules: hydratedModules,
            trees,
            lines,
            templateTrees,
            templateReleases,
            activeProfileId: activeProfile?.id ?? null,
            editingModuleIds,
            error: null,
            errorKind: null,
          }
        })
      })
      .catch((err: unknown) => {
        setState((s) => ({ ...s, status: 'error', error: errorMessage(err), errorKind: 'load' }))
      })
  }, [])

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_API_STATE)
      return
    }
    load()
  }, [enabled, load])

  // Batches same-tick `addMove` calls into a single POST - saving a move
  // cascades to save every earlier ply in the line (see App.tsx's
  // onTogglePlySaved), which would otherwise be N sequential requests instead
  // of the one batched request the backend expects (see the Phase 4 plan).
  const pendingAddsRef = useRef(new Map<number, Map<string, MoveEdge>>())
  const scheduledModuleIdsRef = useRef(new Set<number>())

  const flushAdds = useCallback((moduleId: number) => {
    scheduledModuleIdsRef.current.delete(moduleId)
    const pending = pendingAddsRef.current.get(moduleId)
    if (!pending || pending.size === 0) return
    const moves = Array.from(pending.values())
    pendingAddsRef.current.delete(moduleId)
    addRepertoireMoves(moduleId, moves).then(
      (tree) => setState((s) => ({ ...s, trees: { ...s.trees, [moduleId]: tree } })),
      (err: unknown) => {
        setState((s) => ({ ...s, error: errorMessage(err), errorKind: 'change' }))
        fetchRepertoireTree(moduleId).then(
          (tree) => setState((s) => ({ ...s, trees: { ...s.trees, [moduleId]: tree } })),
          () => {},
        )
      },
    )
  }, [])

  const addMove = useCallback(
    (color: RepertoireColor, fen: string, move: RepertoireMove) => {
      const moduleId = editingIdsRef.current[color]
      if (moduleId === undefined) return
      const key = normalizeFen(fen)
      setState((s) => {
        const current = s.trees[moduleId] ?? {}
        const tree = addMoveToTree(current, key, move)
        return tree === current ? s : { ...s, trees: { ...s.trees, [moduleId]: tree } }
      })
      const pending = pendingAddsRef.current.get(moduleId) ?? new Map<string, MoveEdge>()
      pending.set(`${key}|${move.uci}`, { originFen: key, ...move })
      pendingAddsRef.current.set(moduleId, pending)
      if (!scheduledModuleIdsRef.current.has(moduleId)) {
        scheduledModuleIdsRef.current.add(moduleId)
        queueMicrotask(() => flushAdds(moduleId))
      }
    },
    [flushAdds],
  )

  const addLine = useCallback((color: RepertoireColor, steps: MoveEdge[], source: ApiRepertoireLine['source'] = 'manual', label = '', annotations: ApiRepertoireLine['annotations'] = []) => {
    const moduleId = editingIdsRef.current[color]
    if (moduleId === undefined || steps.length === 0) return
    setState((s) => {
      let tree = s.trees[moduleId] ?? {}
      for (const step of steps) {
        tree = addMoveToTree(tree, step.originFen, step)
      }
      return { ...s, trees: { ...s.trees, [moduleId]: tree } }
    })
    addRepertoireLine(moduleId, steps, label, source, annotations).then(
      () => {
        fetchRepertoireTree(moduleId).then(
          (tree) => setState((s) => ({ ...s, trees: { ...s.trees, [moduleId]: tree } })),
          () => {},
        )
      },
      (err: unknown) => {
        setState((s) => ({ ...s, error: errorMessage(err), errorKind: 'change' }))
        fetchRepertoireTree(moduleId).then(
          (tree) => setState((s) => ({ ...s, trees: { ...s.trees, [moduleId]: tree } })),
          () => {},
        )
      },
    )
  }, [])

  const removeMove = useCallback((color: RepertoireColor, fen: string, uci: string) => {
    const key = normalizeFen(fen)
    const moduleId = editingIdsRef.current[color]
    if (moduleId === undefined) return
    setState((s) => {
      const current = s.trees[moduleId] ?? {}
      const tree = removeMoveFromTree(current, color, key, uci)
      return tree === current ? s : { ...s, trees: { ...s.trees, [moduleId]: tree } }
    })
    removeRepertoireMove(moduleId, key, uci).then(
      (tree) => setState((s) => ({ ...s, trees: { ...s.trees, [moduleId]: tree } })),
      (err: unknown) => {
        setState((s) => ({ ...s, error: errorMessage(err), errorKind: 'change' }))
        fetchRepertoireTree(moduleId).then(
          (tree) => setState((s) => ({ ...s, trees: { ...s.trees, [moduleId]: tree } })),
          () => {},
        )
      },
    )
  }, [])

  const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId) ?? null
  const activeTree = useMemo<Repertoire>(() => {
    const byColor: Repertoire = emptyRepertoire()
    for (const color of ['white', 'black'] as const) {
      const moduleTrees =
        activeProfile?.modules
          .filter((module) => module.enabled && module.color === color)
          .map((module) => ({ moduleId: module.id, tree: state.trees[module.id] ?? {} })) ?? []
      for (const release of activeProfile?.templateReleases?.filter((item) => item.enabled && item.color === color) ?? []) {
        // Negative ids keep immutable global releases distinct from personal
        // module ids while reusing the overlay provenance representation.
        moduleTrees.push({ moduleId: -release.id, tree: state.templateTrees[release.id] ?? {} })
      }
      if (previewRelease?.color === color) {
        moduleTrees.push({ moduleId: -1_000_000_000 - previewRelease.id, tree: previewRelease.tree })
      }
      byColor[color] = mergeRepertoireTrees(moduleTrees)
    }
    return byColor
  }, [activeProfile, previewRelease, state.templateTrees, state.trees])

  const drillLines = useMemo<Partial<Record<RepertoireColor, DrillLine[]>>>(() => {
    const result: Partial<Record<RepertoireColor, DrillLine[]>> = {}
    for (const color of ['white', 'black'] as const) {
      const composed: DrillLine[] = []
      for (const module of activeProfile?.modules.filter((item) => item.enabled && item.color === color) ?? []) {
        for (const line of state.lines[module.id] ?? []) {
          composed.push({
            id: line.uciPath,
            steps: line.steps.map((step) => ({
              fen: step.originFen,
              san: step.san,
              uci: step.uci,
              resultingFen: step.resultingFen,
              mover: sideToMove(step.originFen) === color ? 'own' : 'opponent',
            })),
            sources: [{ kind: 'repertoire', id: module.id, lineId: line.id, name: module.name }],
          })
        }
      }
      for (const pinned of activeProfile?.templateReleases?.filter((item) => item.enabled && item.color === color) ?? []) {
        const release = state.templateReleases[pinned.id]
        for (const line of release?.lines ?? []) {
          composed.push({
            id: line.steps.map((step) => step.uci).join(' '),
            steps: line.steps.map((step) => ({
              fen: step.originFen,
              san: step.san,
              uci: step.uci,
              resultingFen: step.resultingFen,
              mover: sideToMove(step.originFen) === color ? 'own' : 'opponent',
            })),
            sources: [{ kind: 'template_release', id: pinned.id, lineId: line.id, name: pinned.name }],
          })
        }
      }
      result[color] = composed
    }
    return result
  }, [activeProfile, state.lines, state.templateReleases])
  const editingLinePaths = useMemo<Partial<Record<RepertoireColor, string[]>>>(() => {
    const result: Partial<Record<RepertoireColor, string[]>> = {}
    for (const color of ['white', 'black'] as const) {
      const moduleId = state.editingModuleIds[color]
      result[color] = moduleId === undefined ? [] : (state.lines[moduleId] ?? []).map((line) => line.uciPath)
    }
    return result
  }, [state.editingModuleIds, state.lines])
  const editingLines = useMemo<Partial<Record<RepertoireColor, ApiRepertoireLine[]>>>(() => {
    const result: Partial<Record<RepertoireColor, ApiRepertoireLine[]>> = {}
    for (const color of ['white', 'black'] as const) {
      const moduleId = state.editingModuleIds[color]
      result[color] = moduleId === undefined ? [] : state.lines[moduleId] ?? []
    }
    return result
  }, [state.editingModuleIds, state.lines])

  const getContinuations = useCallback(
    (color: RepertoireColor, fen: string): RepertoireMove[] => activeTree[color][normalizeFen(fen)] ?? [],
    [activeTree],
  )
  const isMoveSaved = useCallback(
    (color: RepertoireColor, fen: string, uci: string): boolean => {
      const moduleId = state.editingModuleIds[color]
      if (moduleId === undefined) return false
      return (state.trees[moduleId]?.[normalizeFen(fen)] ?? []).some((move) => move.uci === uci)
    },
    [state.editingModuleIds, state.trees],
  )
  const isMoveInActiveProfile = useCallback(
    (color: RepertoireColor, fen: string, uci: string): boolean =>
      getContinuations(color, fen).some((move) => move.uci === uci),
    [getContinuations],
  )

  const setActiveProfile = useCallback((profileId: number) => {
    setPreviewRelease(null)
    setState((s) => {
      const profile = s.profiles.find((candidate) => candidate.id === profileId)
      if (!profile) return s
      const editingModuleIds: Partial<Record<RepertoireColor, number>> = {}
      for (const color of ['white', 'black'] as const) {
        editingModuleIds[color] = profile.modules.find((module) => module.enabled && module.color === color)?.id
      }
      return { ...s, activeProfileId: profileId, editingModuleIds }
    })
  }, [])

  const setEditingModule = useCallback((color: RepertoireColor, moduleId: number) => {
    setState((s) => {
      const valid =
        s.profiles
          .find((profile) => profile.id === s.activeProfileId)
          ?.modules.some((module) => module.enabled && module.color === color && module.id === moduleId) ?? false
      return valid ? { ...s, editingModuleIds: { ...s.editingModuleIds, [color]: moduleId } } : s
    })
  }, [])

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null, errorKind: null })), [])

  const runAndReload = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      setState((s) => ({ ...s, error: null, errorKind: null }))
      try {
        const result = await operation()
        await load()
        return result
      } catch (err) {
        setState((s) => ({ ...s, error: errorMessage(err), errorKind: 'change' }))
        throw err
      }
    },
    [load],
  )

  return {
    ...state,
    tree: activeTree,
    drillLines,
    editingLinePaths,
    editingLines,
    activeProfile,
    getContinuations,
    isMoveSaved,
    isMoveInActiveProfile,
    addMove,
    addLine,
    removeMove,
    setActiveProfile,
    setEditingModule,
    refresh: load,
    clearError,
    createProfile: (name: string, description = '') => runAndReload(() => createRepertoireProfile(name, description)),
    renameProfile: (id: number, name: string, description?: string) =>
      runAndReload(() => updateRepertoireProfile(id, { name, ...(description === undefined ? {} : { description }) })),
    deleteProfile: (id: number) => runAndReload(() => deleteRepertoireProfile(id)),
    createModule: (color: RepertoireColor, name: string, description = '', profileId?: number) =>
      runAndReload(async () => {
        const module = await createRepertoire(color, name, description)
        if (profileId !== undefined) await setProfileModule(profileId, module.id, 0, true)
        return module
      }),
    renameModule: (id: number, name: string, description?: string) =>
      runAndReload(() => updateRepertoire(id, { name, ...(description === undefined ? {} : { description }) })),
    deleteModule: (id: number) => runAndReload(() => deleteRepertoire(id)),
    setModuleMembership: (profileId: number, moduleId: number, sortOrder: number, enabled: boolean) =>
      runAndReload(() => setProfileModule(profileId, moduleId, sortOrder, enabled)),
    removeModuleMembership: (profileId: number, moduleId: number) =>
      runAndReload(() => removeProfileModule(profileId, moduleId)),
    pinTemplate: (profileId: number, releaseId: number, sortOrder = 0) =>
      runAndReload(() => pinTemplateRelease(profileId, releaseId, sortOrder)),
    unpinTemplate: (profileId: number, releaseId: number) =>
      runAndReload(() => unpinTemplateRelease(profileId, releaseId)),
    copyTemplate: (slug: string, version: number, profileId?: number) =>
      runAndReload(() => copyOpeningTemplateRelease(slug, version, profileId)),
    copyMissingTemplateLines: (slug: string, version: number, moduleId: number) =>
      runAndReload(() => copyMissingOpeningTemplateLines(slug, version, moduleId)),
    previewRelease,
    setPreviewRelease,
  }
}

export type ImportPromptPhase = 'hidden' | 'prompt' | 'result' | 'error'

export type ImportPromptState = {
  phase: ImportPromptPhase
  counts: ImportSummary | null
  confirm: () => void
  dismiss: () => void
  close: () => void
}

/**
 * One-time offer to migrate the anonymous localStorage repertoire into the
 * backend on first sign-in. Tracked per-user (not just "ever shown") in
 * localStorage, since the same browser could later sign into a different
 * account. Deliberately never clears or overwrites the local copy - it's left
 * as an untouched fallback regardless of whether the user imports, dismisses,
 * or the import call fails (see API_CONTRACT.md's import endpoint).
 */
function useImportPrompt(
  user: AuthUser | null,
  localRepertoire: Repertoire,
  apiReady: boolean,
  onImported: () => void,
): ImportPromptState {
  const [phase, setPhase] = useState<ImportPromptPhase>('hidden')
  const [counts, setCounts] = useState<ImportSummary | null>(null)
  const userId = user?.id ?? null

  useEffect(() => {
    if (userId === null || !apiReady) {
      setPhase('hidden')
      return
    }
    const key = `${IMPORT_STATUS_KEY_PREFIX}${userId}`
    let handled: string | null = null
    try {
      handled = localStorage.getItem(key)
    } catch {
      handled = null
    }
    if (handled) return
    if (isRepertoireEmpty(localRepertoire.white) && isRepertoireEmpty(localRepertoire.black)) {
      // Nothing to offer - mark handled so this doesn't re-check every render.
      try {
        localStorage.setItem(key, 'empty')
      } catch {
        // Best-effort only; worst case this re-evaluates next sign-in.
      }
      return
    }
    setPhase('prompt')
    // Only re-evaluate when the signed-in user or API readiness changes, not on
    // every local-repertoire edit - so making more anonymous edits (or the
    // prompt's own confirm/dismiss) never reopens it mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, apiReady])

  const confirm = useCallback(() => {
    if (userId === null) return
    importRepertoire(localRepertoire).then(
      (result) => {
        setCounts(result)
        setPhase('result')
        try {
          localStorage.setItem(`${IMPORT_STATUS_KEY_PREFIX}${userId}`, 'done')
        } catch {
          // Best-effort only.
        }
        onImported()
      },
      () => setPhase('error'),
    )
  }, [userId, localRepertoire, onImported])

  const dismiss = useCallback(() => {
    if (userId !== null) {
      try {
        localStorage.setItem(`${IMPORT_STATUS_KEY_PREFIX}${userId}`, 'skipped')
      } catch {
        // Best-effort only.
      }
    }
    setPhase('hidden')
  }, [userId])

  const close = useCallback(() => setPhase('hidden'), [])

  return { phase, counts, confirm, dismiss, close }
}

/**
 * Saved repertoire moves, keyed by normalized FEN per color (see AGENTS.md's
 * "position identity via FEN"). Anonymous users get the Phase 2 localStorage
 * store; signed-in users get the backend-backed store, with mutations applied
 * optimistically. `user` should be `useAuth()`'s current user, so the two
 * hooks share one session bootstrap rather than each fetching it separately.
 *
 * The four core methods (`getContinuations`/`isMoveSaved`/`addMove`/
 * `removeMove`) are exactly Phase 2's API, so App.tsx/MoveList need no changes
 * beyond passing `user` in; the extra fields below are additive, for the
 * sign-in-aware header/import UI.
 */
export function useRepertoire(user: AuthUser | null) {
  const isAuthenticated = user !== null
  const local = useLocalRepertoireStore()
  const api = useApiRepertoireStore(isAuthenticated)
  const importPrompt = useImportPrompt(user, local.repertoire, api.status === 'ready', api.refresh)

  const active = isAuthenticated ? api : local
  // Normalizes the two stores' differently-named whole-tree fields
  // (`repertoire` for local, `tree` for the API store) into one lookup, for
  // consumers that need the full tree rather than a single position's
  // continuations. Signed-in users see the merged enabled-module graph for
  // their active profile; anonymous users retain one local tree per color.
  const activeRepertoire: Repertoire = isAuthenticated ? api.tree : local.repertoire
  const visibleRepertoire = useMemo<Repertoire>(() => {
    if (isAuthenticated || !api.previewRelease) return activeRepertoire
    const preview = api.previewRelease
    return {
      ...activeRepertoire,
      [preview.color]: mergeRepertoireTrees([
        { moduleId: 0, tree: activeRepertoire[preview.color] },
        { moduleId: -1_000_000_000 - preview.id, tree: preview.tree },
      ]),
    }
  }, [activeRepertoire, api.previewRelease, isAuthenticated])

  const getTree = useCallback(
    (color: RepertoireColor): RepertoireTree => visibleRepertoire[color],
    [visibleRepertoire],
  )
  const getContinuations = useCallback(
    (color: RepertoireColor, fen: string): RepertoireMove[] =>
      visibleRepertoire[color][normalizeFen(fen)] ?? [],
    [visibleRepertoire],
  )

  const addLine = useCallback(
    (color: RepertoireColor, steps: MoveEdge[], source: ApiRepertoireLine['source'] = 'manual', label = '', annotations: ApiRepertoireLine['annotations'] = []) => {
      if (isAuthenticated) {
        api.addLine(color, steps, source, label, annotations)
        return
      }
      for (const step of steps) {
        local.addMove(color, step.originFen, step)
      }
    },
    [api, isAuthenticated, local],
  )

  // The Phase 4 recorder can attribute a session to only one module. Avoid
  // writing misleading analytics when a composed profile contributes multiple
  // modules of the drilled color; multi-module session linkage is the next
  // backend drill migration.
  const recordingModuleIds: Partial<Record<RepertoireColor, number>> = {}
  if (isAuthenticated && api.activeProfile) {
    for (const color of ['white', 'black'] as const) {
      const enabled = api.activeProfile.modules.filter((module) => module.enabled && module.color === color)
      if (enabled.length === 1) recordingModuleIds[color] = enabled[0].id
    }
  }

  return {
    getContinuations,
    isMoveSaved: active.isMoveSaved,
    isMoveInActiveProfile: isAuthenticated
      ? api.isMoveInActiveProfile
      : (color: RepertoireColor, fen: string, uci: string) =>
          (local.repertoire[color][normalizeFen(fen)] ?? []).some((move) => move.uci === uci),
    addMove: active.addMove,
    addLine,
    removeMove: active.removeMove,
    getTree,
    drillLines: isAuthenticated ? api.drillLines : {},
    editingLinePaths: isAuthenticated ? api.editingLinePaths : {},
    editingLines: isAuthenticated ? api.editingLines : {},
    isSignedIn: isAuthenticated,
    isSyncing: isAuthenticated && api.status === 'loading',
    syncError: isAuthenticated ? api.error : null,
    syncErrorKind: isAuthenticated ? api.errorKind : null,
    clearSyncError: api.clearError,
    repertoireIds: recordingModuleIds,
    profiles: isAuthenticated ? api.profiles : local.profiles,
    activeProfile: isAuthenticated ? api.activeProfile : local.activeProfile,
    activeProfileId: isAuthenticated ? api.activeProfileId : local.activeProfileId,
    editingModuleIds: isAuthenticated ? api.editingModuleIds : local.editingModuleIds,
    setActiveProfile: isAuthenticated ? api.setActiveProfile : local.setActiveProfile,
    setEditingModule: isAuthenticated ? api.setEditingModule : local.setEditingModule,
    modules: isAuthenticated ? api.modules : local.modules,
    createProfile: isAuthenticated ? api.createProfile : local.createProfile,
    renameProfile: isAuthenticated ? api.renameProfile : local.renameProfile,
    deleteProfile: isAuthenticated ? api.deleteProfile : local.deleteProfile,
    createModule: isAuthenticated ? api.createModule : local.createModule,
    renameModule: isAuthenticated ? api.renameModule : local.renameModule,
    deleteModule: isAuthenticated ? api.deleteModule : local.deleteModule,
    setModuleMembership: isAuthenticated ? api.setModuleMembership : local.setModuleMembership,
    removeModuleMembership: isAuthenticated ? api.removeModuleMembership : local.removeModuleMembership,
    pinTemplate: api.pinTemplate,
    unpinTemplate: api.unpinTemplate,
    copyTemplate: api.copyTemplate,
    copyMissingTemplateLines: api.copyMissingTemplateLines,
    previewRelease: api.previewRelease,
    setPreviewRelease: api.setPreviewRelease,
    importPrompt,
  }
}
