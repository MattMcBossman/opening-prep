import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOrComputeEngineEvaluation } from './engineEvaluationCache'
import type { EngineEvaluation } from '../types'

function evaluation(fen: string, depth: number): EngineEvaluation {
  return {
    fen,
    depth,
    scoreType: 'cp',
    scoreValue: 12,
    bestMoveUci: 'e2e4',
    pvUci: ['e2e4'],
    thinking: false,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('engineEvaluationCache', () => {
  it('reuses a normalized in-memory evaluation at sufficient depth', async () => {
    const compute = vi.fn().mockResolvedValue(evaluation('engine-memory-fen w - - 0 1', 14))

    await getOrComputeEngineEvaluation('engine-memory-fen w - - 0 1', 14, false, compute)
    await getOrComputeEngineEvaluation('engine-memory-fen w - - 8 19', 14, false, compute)

    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('uses a sufficiently deep persistent result without running Stockfish', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      fen: 'engine-server-fen w - -',
      engineVersion: 'stockfish-18-lite-single',
      depth: 20,
      scoreType: 'cp',
      scoreValue: 20,
      bestMoveUci: null,
      pvUci: [],
    })))
    const compute = vi.fn()

    const result = await getOrComputeEngineEvaluation('engine-server-fen w - - 0 1', 14, true, compute)

    expect(result.depth).toBe(20)
    expect(compute).not.toHaveBeenCalled()
  })
})
