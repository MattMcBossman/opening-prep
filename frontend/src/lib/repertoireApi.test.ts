import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addRepertoireMoves,
  createRepertoire,
  ensureRepertoires,
  fetchRepertoireTree,
  importRepertoire,
  listRepertoires,
  removeRepertoireMove,
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

describe('addRepertoireMoves / removeRepertoireMove', () => {
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
