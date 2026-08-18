import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addRepertoireMoves,
  addRepertoireLine,
  copyOpeningTemplateRelease,
  copyMissingOpeningTemplateLines,
  createRepertoire,
  deleteRepertoireProfile,
  fetchOpeningTemplateRelease,
  ensureRepertoires,
  fetchRepertoireTree,
  importRepertoire,
  listRepertoireProfiles,
  listRepertoireLines,
  listOpeningTemplates,
  listRepertoires,
  removeRepertoireMove,
  removeProfileModule,
  setProfileModule,
  updateRepertoire,
  updateRepertoireProfile,
} from './repertoireApi'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listRepertoires / createRepertoire', () => {
  it('lists repertoire summaries', async () => {
    const summaries = [{ id: 1, name: 'Default', color: 'white', moveCount: 3, createdAt: 'x', updatedAt: 'x' }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(summaries)))

    await expect(listRepertoires()).resolves.toEqual(summaries)
  })

  it('creates a repertoire for a color', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 2, name: 'Default', color: 'black', moveCount: 0, createdAt: 'x', updatedAt: 'x' }))
    vi.stubGlobal('fetch', fetchMock)

    const created = await createRepertoire('black')
    expect(created.color).toBe('black')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ name: 'Default', color: 'black' })
  })
})

describe('profile composition', () => {
  it('lists composed profiles', async () => {
    const profiles = [
      {
        id: 3,
        name: 'Tournament',
        description: '',
        modules: [],
        createdAt: 'x',
        updatedAt: 'x',
      },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(profiles)))

    await expect(listRepertoireProfiles()).resolves.toEqual(profiles)
  })

  it('updates and deletes profiles and modules', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 3, name: 'Blitz' }))
    vi.stubGlobal('fetch', fetchMock)

    await updateRepertoireProfile(3, { name: 'Blitz' })
    await deleteRepertoireProfile(3)
    await updateRepertoire(9, { name: 'Vienna' })

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/v1/repertoires/profiles/3/', 'PATCH'],
      ['/api/v1/repertoires/profiles/3/', 'DELETE'],
      ['/api/v1/repertoires/9/', 'PATCH'],
    ])
  })

  it('adds or updates one module membership', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 3, modules: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await setProfileModule(3, 9, 2, false)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/repertoires/profiles/3/modules/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ moduleId: 9, sortOrder: 2, enabled: false })
  })

  it('removes membership without deleting the module', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 3, modules: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await removeProfileModule(3, 9)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/repertoires/profiles/3/modules/')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ moduleId: 9 })
  })
})

describe('global opening library', () => {
  it('lists and previews immutable releases', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    await listOpeningTemplates()
    await fetchOpeningTemplateRelease('vienna-game', 2)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/opening-templates/',
      '/api/v1/opening-templates/vienna-game/releases/2/',
    ])
  })

  it('copies a release into an editable module', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await copyOpeningTemplateRelease('vienna-game', 2, 4)
    await copyMissingOpeningTemplateLines('vienna-game', 2, 9)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ profileId: 4 })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/opening-templates/vienna-game/releases/2/copy-missing/')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ moduleId: 9 })
  })
})

describe('addRepertoireMoves / removeRepertoireMove', () => {
  it('lists and authors explicit move-order lines', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const steps = [{ originFen: 'root w - -', san: 'e4', uci: 'e2e4', resultingFen: 'after b - -' }]

    await listRepertoireLines(4)
    await addRepertoireLine(4, steps, 'Vienna main line')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/repertoires/4/lines/')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/repertoires/4/lines/')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      label: 'Vienna main line',
      source: 'manual',
      annotations: [],
      conflictPolicy: 'reject',
      steps,
    })
  })

  it('POSTs a batch of moves and returns the updated tree', async () => {
    const tree = { 'root w - -': [{ san: 'e4', uci: 'e2e4', resultingFen: 'after w - -' }] }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tree))
    vi.stubGlobal('fetch', fetchMock)

    const moves = [{ originFen: 'root w - -', san: 'e4', uci: 'e2e4', resultingFen: 'after w - -' }]
    const result = await addRepertoireMoves(1, moves)

    expect(result).toEqual(tree)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/repertoires/1/moves/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ moves })
  })

  it('DELETEs a single edge with the origin FEN and uci in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await removeRepertoireMove(1, 'root w - -', 'e2e4')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/repertoires/1/moves/')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ originFen: 'root w - -', uci: 'e2e4' })
  })
})

describe('importRepertoire', () => {
  it('POSTs both color trees and returns per-color import counts', async () => {
    const summary = { white: { imported: 12, skipped: 3 }, black: { imported: 0, skipped: 0 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(summary)))

    const local = { white: { 'root w - -': [] }, black: {} }
    await expect(importRepertoire(local)).resolves.toEqual(summary)
  })
})

describe('ensureRepertoires', () => {
  it('fetches the tree for existing white/black repertoires', async () => {
    const summaries = [
      { id: 1, name: 'Default', color: 'white', moveCount: 1, createdAt: 'x', updatedAt: 'x' },
      { id: 2, name: 'Default', color: 'black', moveCount: 0, createdAt: 'x', updatedAt: 'x' },
    ]
    const whiteTree = { 'root w - -': [{ san: 'e4', uci: 'e2e4', resultingFen: 'after w - -' }] }
    const blackTree = {}

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/repertoires/') return Promise.resolve(jsonResponse(summaries))
      if (url === '/api/v1/repertoires/1/tree/') return Promise.resolve(jsonResponse(whiteTree))
      if (url === '/api/v1/repertoires/2/tree/') return Promise.resolve(jsonResponse(blackTree))
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ensureRepertoires()
    expect(result.white).toEqual({ id: 1, tree: whiteTree })
    expect(result.black).toEqual({ id: 2, tree: blackTree })
  })

  it('lazily creates a color missing from the summary list', async () => {
    const summaries = [{ id: 1, name: 'Default', color: 'white', moveCount: 0, createdAt: 'x', updatedAt: 'x' }]
    const createdBlack = { id: 9, name: 'Default', color: 'black', moveCount: 0, createdAt: 'x', updatedAt: 'x' }

    const fetchMock = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/v1/repertoires/' && init?.method === 'GET') {
        return Promise.resolve(jsonResponse(summaries))
      }
      if (url === '/api/v1/repertoires/' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(createdBlack))
      }
      if (url === '/api/v1/repertoires/1/tree/') return Promise.resolve(jsonResponse({}))
      if (url === '/api/v1/repertoires/9/tree/') return Promise.resolve(jsonResponse({}))
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ensureRepertoires()
    expect(result.black.id).toBe(9)
  })
})

// fetchRepertoireTree is exercised indirectly above; a direct smoke test guards its URL shape.
describe('fetchRepertoireTree', () => {
  it('fetches the tree for a given repertoire id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await fetchRepertoireTree(5)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/repertoires/5/tree/', expect.anything())
  })
})
