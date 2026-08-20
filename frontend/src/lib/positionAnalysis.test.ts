import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisCandidate } from '../types'
import { analysisArrowMoves, deriveRecurringMoves, describeRecurringMove, fetchPositionAnalysis, persistPositionAnalysis, subscribeToPositionAnalysisUpdates } from './positionAnalysis'

const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const candidates: AnalysisCandidate[] = [
  { rank: 1, depth: 18, scoreType: 'cp', scoreValue: 24, bestMoveUci: 'e2e4', pvUci: ['e2e4', 'e7e5', 'g1f3'] },
  { rank: 2, depth: 18, scoreType: 'cp', scoreValue: 18, bestMoveUci: 'g1f3', pvUci: ['g1f3', 'd7d5', 'd2d4'] },
  { rank: 3, depth: 18, scoreType: 'cp', scoreValue: 12, bestMoveUci: 'd2d4', pvUci: ['d2d4', 'g8f6', 'g1f3'] },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deriveRecurringMoves', () => {
  it('keeps only concrete moves found in at least two candidate lines', () => {
    expect(deriveRecurringMoves(fen, candidates)).toEqual([
      {
        uci: 'g1f3',
        san: 'Nf3',
        side: 'white',
        earliestPly: 0,
        latestPly: 2,
        lineCount: 3,
        totalLines: 3,
        timing: 'mixed',
        prerequisiteLines: [['e2e4', 'e7e5'], ['d2d4', 'g8f6']],
        immediateCandidateRank: 2,
        immediateCentipawnLoss: 6,
      },
      {
        uci: 'd2d4',
        san: 'd4',
        side: 'white',
        earliestPly: 0,
        latestPly: 2,
        lineCount: 2,
        totalLines: 3,
        timing: 'mixed',
        prerequisiteLines: [['g1f3', 'd7d5']],
        immediateCandidateRank: 3,
        immediateCentipawnLoss: 12,
      },
    ])
  })

  it('describes only candidate-backed timing and immediate comparisons', () => {
    const move = deriveRecurringMoves(fen, candidates)[0]
    expect(describeRecurringMove(fen, move)).toBe(
      'White can play Nf3 immediately as a competitive candidate; other lines use it after e5, Nf6.',
    )
  })

  it('does not coerce mate scores into an immediate centipawn comparison', () => {
    const mateCandidates: AnalysisCandidate[] = [
      { rank: 1, depth: 18, scoreType: 'mate', scoreValue: 3, bestMoveUci: 'e2e4', pvUci: ['e2e4', 'e7e5', 'g1f3'] },
      { rank: 2, depth: 18, scoreType: 'mate', scoreValue: 5, bestMoveUci: 'g1f3', pvUci: ['g1f3', 'd7d5', 'e2e4'] },
    ]
    const knight = deriveRecurringMoves(fen, mateCandidates).find((move) => move.uci === 'g1f3')
    expect(knight?.immediateCandidateRank).toBe(2)
    expect(knight?.immediateCentipawnLoss).toBeNull()
  })

  it('selects rank one and recurrent moves for both sides as arrow evidence', () => {
    const arrowCandidates: AnalysisCandidate[] = [
      { rank: 1, depth: 24, scoreType: 'cp', scoreValue: 24, bestMoveUci: 'e2e4', pvUci: ['e2e4', 'd7d5', 'g1f3'] },
      { rank: 2, depth: 24, scoreType: 'cp', scoreValue: 18, bestMoveUci: 'g1f3', pvUci: ['g1f3', 'd7d5', 'd2d4'] },
      { rank: 3, depth: 24, scoreType: 'cp', scoreValue: 12, bestMoveUci: 'd2d4', pvUci: ['d2d4', 'g8f6', 'g1f3'] },
    ]
    const analysis = {
      fen,
      engineVersion: 'stockfish-18-lite-single',
      analysisProfile: 'drill-review-basic-v1',
      depth: 24,
      multiPv: 3,
      candidates: arrowCandidates,
      recurringMoves: deriveRecurringMoves(fen, arrowCandidates),
    }
    const arrows = analysisArrowMoves(analysis, 'white')
    expect(arrows).toEqual(expect.arrayContaining([
      expect.objectContaining({ uci: 'e2e4', side: 'white', isBest: true }),
      expect.objectContaining({ uci: 'g1f3', side: 'white', isBest: false }),
      expect.objectContaining({ uci: 'd7d5', side: 'black', isBest: false }),
    ]))
    expect(arrows).toHaveLength(5)
    expect(arrows.filter((move) => move.side === 'white')).toHaveLength(3)
    expect(analysisArrowMoves(analysis, 'white', 4)).toHaveLength(4)
  })

  it('reserves at least three arrows for the training side when the candidates contain them', () => {
    const arrowCandidates: AnalysisCandidate[] = [
      { rank: 1, depth: 24, scoreType: 'cp', scoreValue: 24, bestMoveUci: 'e2e4', pvUci: ['e2e4', 'd7d5', 'e4d5', 'd8d5'] },
      { rank: 2, depth: 24, scoreType: 'cp', scoreValue: 18, bestMoveUci: 'g1f3', pvUci: ['g1f3', 'd7d5', 'd2d4', 'g8f6'] },
      { rank: 3, depth: 24, scoreType: 'cp', scoreValue: 12, bestMoveUci: 'd2d4', pvUci: ['d2d4', 'g8f6', 'c2c4', 'e7e6'] },
    ]
    const analysis = {
      fen,
      engineVersion: 'stockfish-18-lite-single',
      analysisProfile: 'drill-review-basic-v1',
      depth: 24,
      multiPv: 3,
      candidates: arrowCandidates,
      recurringMoves: deriveRecurringMoves(fen, arrowCandidates),
    }
    const blackArrows = analysisArrowMoves(analysis, 'black')
    expect(blackArrows.filter((move) => move.side === 'black').length).toBeGreaterThanOrEqual(3)
    expect(blackArrows.length).toBeLessThanOrEqual(8)
  })
})

describe('position analysis API', () => {
  it('treats a cache miss as null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'No cached position analysis.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(fetchPositionAnalysis(`${fen} `)).resolves.toBeNull()
  })

  it('uploads the bounded candidate evidence', async () => {
    const response = {
      fen,
      engineVersion: 'Stockfish 18',
      analysisProfile: 'drill-review-basic-v1',
      depth: 18,
      multiPv: 3,
      candidates,
      recurringMoves: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(persistPositionAnalysis(fen, candidates)).resolves.toMatchObject({ depth: 18, multiPv: 3 })
    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toMatchObject({
      fen,
      analysisProfile: 'drill-review-basic-v1',
      candidates,
    })
  })

  it('publishes completed rank-one evaluations to subscribers', async () => {
    const response = {
      fen,
      engineVersion: 'Stockfish 18',
      analysisProfile: 'drill-review-basic-v1',
      depth: 18,
      multiPv: 3,
      candidates,
      recurringMoves: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    const listener = vi.fn()
    const unsubscribe = subscribeToPositionAnalysisUpdates(listener)

    await persistPositionAnalysis(`${fen} `, candidates)

    expect(listener).toHaveBeenCalledWith({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      evaluation: { scoreType: 'cp', scoreValue: 24, depth: 18 },
    })
    unsubscribe()
    await persistPositionAnalysis(fen, candidates)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
