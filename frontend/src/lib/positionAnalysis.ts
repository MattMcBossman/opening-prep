import { Chess } from 'chess.js'
import { StockfishEngine } from '../engine/stockfishEngine'
import type { AnalysisCandidate, PositionAnalysis, RecurringAnalysisMove } from '../types'
import { ApiError, apiRequest } from './apiClient'
import { normalizeFen } from './chessUtils'
import { ENGINE_VERSION } from './engineEvaluationCache'

export const ANALYSIS_PROFILE = 'drill-review-basic-v1'
export const ANALYSIS_DEPTH = 24
export const ANALYSIS_MULTIPV = 3
export const ANALYSIS_PV_HORIZON = 10
export const IMMEDIATE_MOVE_INFERIOR_CP = 50

const memory = new Map<string, PositionAnalysis>()
const inFlight = new Map<string, Promise<PositionAnalysis>>()

export type AnalysisArrowMove = {
  uci: string
  side: 'white' | 'black'
  frequency: number
  isBest: boolean
}

function key(fen: string): string {
  return `${ENGINE_VERSION}:${ANALYSIS_PROFILE}:${normalizeFen(fen)}`
}

function hydrateAnalysis(analysis: PositionAnalysis, fen: string): PositionAnalysis {
  const recurringMoves = analysis.recurringMoves.every((move) => move.timing && move.prerequisiteLines)
    ? analysis.recurringMoves
    : deriveRecurringMoves(fen, analysis.candidates)
  return { ...analysis, fen, recurringMoves }
}

export function deriveRecurringMoves(fen: string, candidates: AnalysisCandidate[]): RecurringAnalysisMove[] {
  const evidence = new Map<string, Omit<RecurringAnalysisMove, 'timing' | 'prerequisiteLines' | 'immediateCandidateRank' | 'immediateCentipawnLoss'> & { plies: number[], prerequisiteLines: string[][] }>()
  for (const candidate of candidates) {
    const game = new Chess(fen)
    const seen = new Set<string>()
    candidate.pvUci.forEach((uci, ply) => {
      const side = game.turn() === 'w' ? 'white' : 'black'
      const result = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
      if (!result) return
      const evidenceKey = `${side}:${uci}`
      const current = evidence.get(evidenceKey) ?? {
        uci,
        san: result.san,
        side,
        earliestPly: ply,
        latestPly: ply,
        lineCount: 0,
        totalLines: candidates.length,
        plies: [],
        prerequisiteLines: [],
      }
      current.plies.push(ply)
      if (ply > 0) current.prerequisiteLines.push(candidate.pvUci.slice(0, ply))
      current.earliestPly = Math.min(current.earliestPly, ply)
      current.latestPly = Math.max(current.latestPly, ply)
      if (!seen.has(evidenceKey)) {
        current.lineCount += 1
        seen.add(evidenceKey)
      }
      evidence.set(evidenceKey, current)
    })
  }
  return [...evidence.values()]
    .filter((move) => move.lineCount >= 2)
    .sort((left, right) => right.lineCount - left.lineCount || left.earliestPly - right.earliestPly || left.uci.localeCompare(right.uci))
    .map(({ plies, prerequisiteLines, ...move }) => {
      const immediate = candidates.find((candidate) => candidate.bestMoveUci === move.uci)
      const best = candidates.find((candidate) => candidate.rank === 1)
      let immediateCentipawnLoss: number | null = null
      if (immediate && best && immediate.scoreType === 'cp' && best.scoreType === 'cp') {
        immediateCentipawnLoss = Math.max(0, move.side === 'white'
          ? best.scoreValue - immediate.scoreValue
          : immediate.scoreValue - best.scoreValue)
      }
      const uniquePrerequisites = [...new Map(
        prerequisiteLines.map((line) => [line.join(' '), line]),
      ).values()].slice(0, 3)
      return {
        ...move,
        timing: Math.min(...plies) === 0 ? 'mixed' as const : 'prepared' as const,
        prerequisiteLines: uniquePrerequisites,
        immediateCandidateRank: immediate?.rank ?? null,
        immediateCentipawnLoss,
      }
    })
}

export function describeRecurringMove(fen: string, move: RecurringAnalysisMove): string {
  const orderingMoves = [...new Set(move.prerequisiteLines.map((line) => {
    const san = line.length > 0 ? new Chess(fen) : null
    let last = ''
    for (const uci of line) {
      const result = san?.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
      if (!result) break
      last = result.san
    }
    return last
  }).filter(Boolean))].slice(0, 3)
  const after = orderingMoves.length > 0 ? ` after ${orderingMoves.join(', ')}` : ''
  const side = move.side === 'white' ? 'White' : 'Black'
  if (move.timing === 'prepared') {
    const rootSide = new Chess(fen).turn() === 'w' ? 'white' : 'black'
    const comparison = move.side === rootSide ? '; it is not one of the immediate candidate moves' : ''
    return `${side} plays ${move.san} later${after}${comparison}.`
  }
  if (move.immediateCentipawnLoss !== null && move.immediateCentipawnLoss >= IMMEDIATE_MOVE_INFERIOR_CP) {
    return `${side} also considers ${move.san} immediately, but it evaluates materially worse than the top candidate; other lines use it${after}.`
  }
  if (move.immediateCandidateRank !== null) {
    return `${side} can play ${move.san} immediately as a competitive candidate; other lines use it${after}.`
  }
  return `${side} uses ${move.san} across multiple candidate continuations${after}.`
}

/**
 * A bounded, training-side-first arrow set from the concrete MultiPV evidence.
 * Prefer moves recurring across lines, but backfill to three training-side
 * ideas when the search contains them. Opponent moves remain useful context,
 * but receive fewer slots so they do not overwhelm the board.
 */
export function analysisArrowMoves(
  analysis: PositionAnalysis,
  trainingSide: 'white' | 'black' = 'white',
  limit = 8,
): AnalysisArrowMove[] {
  const best = analysis.candidates.find((candidate) => candidate.rank === 1) ?? analysis.candidates[0]
  const result: AnalysisArrowMove[] = []
  const seen = new Set<string>()
  const evidence = new Map<string, { uci: string; side: 'white' | 'black'; lineCount: number; earliestPly: number }>()
  for (const candidate of analysis.candidates) {
    const game = new Chess(analysis.fen)
    const seenInLine = new Set<string>()
    candidate.pvUci.forEach((uci, ply) => {
      const side = game.turn() === 'w' ? 'white' : 'black'
      const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
      if (!move) return
      const key = `${side}:${uci.slice(0, 4)}`
      const existing = evidence.get(key) ?? { uci, side, lineCount: 0, earliestPly: ply }
      existing.earliestPly = Math.min(existing.earliestPly, ply)
      if (!seenInLine.has(key)) {
        existing.lineCount += 1
        seenInLine.add(key)
      }
      evidence.set(key, existing)
    })
  }
  if (best) {
    seen.add(best.bestMoveUci.slice(0, 4))
    result.push({
      uci: best.bestMoveUci,
      side: new Chess(analysis.fen).turn() === 'w' ? 'white' : 'black',
      frequency: 100,
      isBest: true,
    })
  }

  const ranked = [...evidence.values()].sort(
    (left, right) => right.lineCount - left.lineCount
      || left.earliestPly - right.earliestPly
      || left.uci.localeCompare(right.uci),
  )
  const add = (moves: typeof ranked, targetForSide: number) => {
    for (const move of moves) {
      if (result.length >= limit || result.filter((item) => item.side === move.side).length >= targetForSide) break
      const canonical = move.uci.slice(0, 4)
      if (seen.has(canonical)) continue
      seen.add(canonical)
      result.push({
        uci: move.uci,
        side: move.side,
        frequency: (move.lineCount / analysis.candidates.length) * 100,
        isBest: false,
      })
    }
  }

  const trainingMoves = ranked.filter((move) => move.side === trainingSide)
  const opponentMoves = ranked.filter((move) => move.side !== trainingSide)
  add(trainingMoves, 3)
  add(opponentMoves.filter((move) => move.lineCount >= 2), 2)
  add(trainingMoves, 5)
  add(opponentMoves, 3)
  return result
}

export async function fetchPositionAnalysis(fen: string): Promise<PositionAnalysis | null> {
  const remembered = memory.get(key(fen))
  if (remembered) return { ...remembered, fen }
  const params = new URLSearchParams({ fen, engineVersion: ENGINE_VERSION, analysisProfile: ANALYSIS_PROFILE })
  try {
    const analysis = await apiRequest<PositionAnalysis>(`/explorer/position-analyses/?${params}`)
    const hydrated = hydrateAnalysis(analysis, fen)
    memory.set(key(fen), hydrated)
    return hydrated
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function persistPositionAnalysis(fen: string, candidates: AnalysisCandidate[]): Promise<PositionAnalysis> {
  const analysis = await apiRequest<PositionAnalysis>('/explorer/position-analyses/', {
    method: 'PUT',
    body: { fen, engineVersion: ENGINE_VERSION, analysisProfile: ANALYSIS_PROFILE, candidates },
  })
  const hydrated = hydrateAnalysis(analysis, fen)
  memory.set(key(fen), hydrated)
  return hydrated
}

export async function getOrComputePositionAnalysis(
  fen: string,
  signedIn: boolean,
  engine: StockfishEngine,
  onCached?: (analysis: PositionAnalysis) => void,
): Promise<PositionAnalysis> {
  const cacheKey = key(fen)
  const remembered = memory.get(cacheKey)
  if (remembered && remembered.depth >= ANALYSIS_DEPTH && remembered.multiPv >= ANALYSIS_MULTIPV) {
    return { ...remembered, fen }
  }
  if (remembered) onCached?.({ ...remembered, fen })
  const pending = inFlight.get(cacheKey)
  if (pending) return pending

  const request = (async () => {
    if (signedIn) {
      const cached = await fetchPositionAnalysis(fen).catch(() => null)
      if (cached) onCached?.(cached)
      if (cached && cached.depth >= ANALYSIS_DEPTH && cached.multiPv >= ANALYSIS_MULTIPV) return cached
    }
    const toAnalysis = (candidates: AnalysisCandidate[]): PositionAnalysis => ({
      fen,
      engineVersion: ENGINE_VERSION,
      analysisProfile: ANALYSIS_PROFILE,
      depth: Math.min(...candidates.map((candidate) => candidate.depth)),
      multiPv: candidates.length,
      candidates,
      recurringMoves: deriveRecurringMoves(fen, candidates),
    })
    const candidates = await engine.evaluateMultiPvOnce(
      fen,
      ANALYSIS_DEPTH,
      ANALYSIS_MULTIPV,
      ANALYSIS_PV_HORIZON,
      (intermediate) => {
        if (intermediate.length >= ANALYSIS_MULTIPV) onCached?.(toAnalysis(intermediate))
      },
    )
    if (candidates.length === 0) throw new Error('Stockfish returned no candidate lines.')
    const local = toAnalysis(candidates)
    if (signedIn) return persistPositionAnalysis(fen, candidates).catch(() => local)
    memory.set(cacheKey, local)
    return local
  })().finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, request)
  return request
}
