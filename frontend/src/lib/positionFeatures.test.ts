import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMoveFeatureComparison, fetchPositionFeatures } from './positionFeatures'

const fen = '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1'

afterEach(() => vi.unstubAllGlobals())

describe('position feature API', () => {
  it('fetches deterministic square evidence and reuses normalized-FEN memory', async () => {
    const response = {
      fen: '4k3/8/8/8/3P4/8/8/4K3 w - -',
      schemaVersion: 1,
      extractorVersion: 'concrete-v2',
      facts: [{
        id: 'pawns:passed_pawn:white:d4',
        category: 'pawns',
        kind: 'passed_pawn',
        side: 'white',
        severity: 'advantage',
        confidence: 'certain',
        summary: "White's pawn on d4 is passed.",
        squares: ['d4'],
        pieces: ['white pawn'],
        evidence: {},
      }],
      checksum: 'abc',
      updatedAt: '2026-08-10T00:00:00Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPositionFeatures(fen)).resolves.toMatchObject({ fen, facts: response.facts })
    await expect(fetchPositionFeatures(response.fen)).resolves.toMatchObject({ facts: response.facts })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requests a before/after comparison for a move', async () => {
    const response = {
      originFen: fen,
      moveUci: 'd4d5',
      moveSan: 'd5',
      resultingFen: '4k3/8/8/3P4/8/8/8/4K3 b - -',
      before: { fen, schemaVersion: 1, extractorVersion: 'concrete-v2', facts: [], checksum: 'a' },
      after: { fen, schemaVersion: 1, extractorVersion: 'concrete-v2', facts: [], checksum: 'b' },
      addedFacts: [],
      removedFacts: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchMoveFeatureComparison(fen, 'd4d5')).resolves.toMatchObject({ moveSan: 'd5' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('move=d4d5')
  })
})
