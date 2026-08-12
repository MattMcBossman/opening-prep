import { describe, expect, it } from 'vitest'
import { activeLocalRepertoire, parseLocalProfileStore } from './localProfileStore'

describe('local profile store migration', () => {
  it('upgrades the legacy two-color repertoire into reusable modules', () => {
    const store = parseLocalProfileStore({ white: { root: [{ san: 'e4', uci: 'e2e4', resultingFen: 'next' }] }, black: {} })
    expect(store.version).toBe(3)
    expect(store.modules.map((module) => module.name)).toEqual(['Imported White module'])
    expect(activeLocalRepertoire(store).white.root[0].uci).toBe('e2e4')
  })

  it('removes empty legacy General modules without deleting populated ones', () => {
    const store = parseLocalProfileStore({
      version: 3, nextId: 4, activeProfileId: 1, editingModuleIds: { white: 2, black: 3 },
      profiles: [{ id: 1, name: 'Default', modules: [
        { moduleId: 2, enabled: true, sortOrder: 0 }, { moduleId: 3, enabled: true, sortOrder: 1 },
      ] }],
      modules: [
        { id: 2, name: 'General White', color: 'white', tree: { root: [{ san: 'e4', uci: 'e2e4', resultingFen: 'one' }] } },
        { id: 3, name: 'General Black', color: 'black', tree: {} },
      ],
    })
    expect(store.modules.map((module) => module.name)).toEqual(['Imported White module'])
    expect(store.profiles[0].modules.map((link) => link.moduleId)).toEqual([2])
    expect(store.editingModuleIds).toEqual({ white: 2 })
  })

  it('composes enabled modules in profile order', () => {
    const store = parseLocalProfileStore({
      version: 3, nextId: 5, activeProfileId: 1, editingModuleIds: { white: 2 },
      profiles: [{ id: 1, name: 'Blitz', modules: [
        { moduleId: 2, enabled: true, sortOrder: 0 }, { moduleId: 4, enabled: true, sortOrder: 1 },
      ] }],
      modules: [
        { id: 2, name: 'Vienna', color: 'white', tree: { root: [{ san: 'e4', uci: 'e2e4', resultingFen: 'one' }] } },
        { id: 4, name: 'Stonewall', color: 'white', tree: { root: [{ san: 'd4', uci: 'd2d4', resultingFen: 'two' }] } },
      ],
    })
    expect(activeLocalRepertoire(store).white.root.map((move) => move.uci)).toEqual(['e2e4', 'd2d4'])
  })
})
