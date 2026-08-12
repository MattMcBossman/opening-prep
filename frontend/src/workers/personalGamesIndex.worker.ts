/// <reference lib="webworker" />

import { Chess } from 'chess.js'
import { normalizeFen } from '../lib/chessUtils'
import type { ExplorerResponse, RepertoireColor } from '../types'

type Source = 'lichess' | 'chesscom'
type Bucket = {
  source: Source
  color: RepertoireColor
  month: string
  speed: string
  san: string
  uci: string
  white: number
  draws: number
  black: number
}
type StoredIndex = {
  graph: Map<string, Bucket[]>
  gameIds: Set<string>
  latest: Partial<Record<Source, number>>
}
type QueryFilters = { since?: string; until?: string; speeds?: string[]; databases?: Source[] }
type Request =
  | { id: number; type: 'init'; userId: number }
  | { id: number; type: 'refresh'; sources: Source[] }
  | { id: number; type: 'query'; fen: string; color: RepertoireColor; filters?: QueryFilters }

let userId = 0
let index: StoredIndex = { graph: new Map(), gameIds: new Set(), latest: {} }
// v2 invalidates early client indexes that could persist a partial Lichess
// history and then incorrectly treat its newest timestamp as a complete base.
const DB_NAME = 'mainline-personal-games-v2'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('indexes')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function load(): Promise<void> {
  const db = await openDb()
  index = await new Promise((resolve, reject) => {
    const request = db.transaction('indexes').objectStore('indexes').get(userId)
    request.onsuccess = () => resolve(request.result ?? { graph: new Map(), gameIds: new Set(), latest: {} })
    request.onerror = () => reject(request.error)
  })
  db.close()
}

async function save(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('indexes', 'readwrite').objectStore('indexes').put(index, userId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  db.close()
}

function resultCounts(result: string): [number, number, number] {
  if (result === '1-0') return [1, 0, 0]
  if (result === '0-1') return [0, 0, 1]
  return [0, 1, 0]
}

function addGame(source: Source, raw: Record<string, unknown>): boolean {
  const chess = new Chess()
  let id: string
  let playerColor: RepertoireColor
  let playedAt: number
  let speed: string
  let result: string

  if (source === 'lichess') {
    id = `lichess:${String(raw.id ?? '')}`
    const players = raw.players as Record<string, { user?: { name?: string } }> | undefined
    const username = String((raw as { mainlineUsername?: string }).mainlineUsername ?? '').toLowerCase()
    playerColor = players?.white?.user?.name?.toLowerCase() === username ? 'white' : 'black'
    playedAt = Number(raw.createdAt ?? 0)
    speed = String(raw.speed ?? '')
    result = raw.winner === 'white' ? '1-0' : raw.winner === 'black' ? '0-1' : '1/2-1/2'
    const moves = String(raw.moves ?? '').trim()
    if (!moves) return false
    try { chess.loadPgn(moves) } catch { return false }
  } else {
    id = `chesscom:${String(raw.url ?? raw.uuid ?? '')}`
    playedAt = Number(raw.end_time ?? 0) * 1000
    speed = String(raw.time_class ?? '')
    const pgn = String(raw.pgn ?? '')
    try { chess.loadPgn(pgn) } catch { return false }
    const headers = chess.header()
    const username = String((raw as { mainlineUsername?: string }).mainlineUsername ?? '').toLowerCase()
    playerColor = headers.White?.toLowerCase() === username ? 'white' : 'black'
    result = headers.Result ?? '*'
  }
  if (!id || index.gameIds.has(id) || !playedAt) return false

  const history = chess.history({ verbose: true })
  chess.reset()
  const [white, draws, black] = resultCounts(result)
  const month = new Date(playedAt).toISOString().slice(0, 7)
  for (const move of history) {
    const fen = normalizeFen(chess.fen())
    const buckets = index.graph.get(fen) ?? []
    const uci = move.from + move.to + (move.promotion ?? '')
    const existing = buckets.find((row) => row.source === source && row.color === playerColor
      && row.month === month && row.speed === speed && row.uci === uci)
    if (existing) {
      existing.white += white
      existing.draws += draws
      existing.black += black
    } else {
      buckets.push({ source, color: playerColor, month, speed, san: move.san,
        uci, white, draws, black })
      index.graph.set(fen, buckets)
    }
    chess.move(move)
  }
  index.gameIds.add(id)
  index.latest[source] = Math.max(index.latest[source] ?? 0, playedAt)
  return true
}

async function streamSource(source: Source): Promise<number> {
  const params = new URLSearchParams()
  if (index.latest[source]) params.set('since', String(index.latest[source]))
  const url = `/api/v1/explorer/game-export/${source}/?${params}`
  let response = await fetch(url, { credentials: 'same-origin' })
  let rateLimitAttempt = 0
  while (response.status === 429) {
    const parsedDelay = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
    const upstreamDelay = Number.isFinite(parsedDelay) && parsedDelay > 0 ? parsedDelay : 0
    const retryDelaySeconds = Math.min(15 * 60, Math.max(90, upstreamDelay) * (2 ** rateLimitAttempt))
    rateLimitAttempt += 1
    self.postMessage({ type: 'rate-limited', source, retryDelaySeconds })
    // Preserve everything parsed so far before a potentially long wait. The
    // compact index belongs in IndexedDB; sessionStorage is too small for a
    // multi-thousand-game graph.
    await save()
    await new Promise((resolve) => setTimeout(resolve, retryDelaySeconds * 1000))
    response = await fetch(url, { credentials: 'same-origin' })
  }
  if (!response.ok || !response.body) throw new Error(`${source} game export failed (${response.status})`)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ''
  let added = 0
  while (true) {
    const { value = '', done } = await reader.read()
    pending += value
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const raw = JSON.parse(line) as Record<string, unknown>
      // The backend supplies the authoritative linked username separately on every record.
      if (addGame(source, raw)) {
        added += 1
        self.postMessage({ type: 'game-indexed', source })
        // Chess.com archives commonly arrive as one large response chunk. Yield
        // between records so the main thread can render every progress event
        // instead of React receiving an entire archive in one task and batching it.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    if (done) break
  }
  if (pending.trim() && addGame(source, JSON.parse(pending) as Record<string, unknown>)) {
    added += 1
    self.postMessage({ type: 'game-indexed', source })
  }
  return added
}

function query(fen: string, color: RepertoireColor, filters: QueryFilters = {}): ExplorerResponse {
  const sources = filters.databases ?? ['lichess', 'chesscom']
  const moves = new Map<string, ExplorerResponse['moves'][number]>()
  for (const row of index.graph.get(normalizeFen(fen)) ?? []) {
    if (row.color !== color || !sources.includes(row.source)) continue
    if (filters.since && row.month < filters.since.slice(0, 7)) continue
    if (filters.until && row.month > filters.until.slice(0, 7)) continue
    if (filters.speeds?.length && !filters.speeds.includes(row.speed)) continue
    const current = moves.get(row.uci) ?? { san: row.san, uci: row.uci, white: 0, draws: 0, black: 0, totalGames: 0 }
    current.white += row.white
    current.draws += row.draws
    current.black += row.black
    current.totalGames += row.white + row.draws + row.black
    moves.set(row.uci, current)
  }
  const allRows = [...moves.values()].sort((a, b) => b.totalGames - a.totalGames)
  return {
    totalGames: allRows.reduce((sum, row) => sum + row.totalGames, 0),
    moves: allRows.slice(0, 12),
    opening: null,
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data
  try {
    if (message.type === 'init') { userId = message.userId; await load(); self.postMessage({ id: message.id, data: null }); return }
    if (message.type === 'refresh') {
      let added = 0
      for (const source of message.sources) {
        try {
          added += await streamSource(source)
        } finally {
          // Checkpoint each completed or failed source independently so a later
          // provider error cannot discard progress from an earlier one.
          await save()
        }
      }
      await save()
      self.postMessage({ id: message.id, data: added })
      return
    }
    self.postMessage({ id: message.id, data: query(message.fen, message.color, message.filters) })
  } catch (error) {
    self.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'Personal-game indexing failed.' })
  }
}
