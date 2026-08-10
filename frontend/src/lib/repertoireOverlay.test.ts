import { describe, expect, it } from 'vitest'
import { findMissingReleaseLines, mergeRepertoireTrees } from './repertoireOverlay'

describe('mergeRepertoireTrees', () => {
  it('keeps profile order and deduplicates identical moves with provenance', () => {
    const e4 = { san: 'e4', uci: 'e2e4', resultingFen: 'after-e4 b - -' }
    const d4 = { san: 'd4', uci: 'd2d4', resultingFen: 'after-d4 b - -' }

    const merged = mergeRepertoireTrees([
      { moduleId: 7, tree: { 'root w - -': [e4] } },
      { moduleId: 9, tree: { 'root w - -': [e4, d4] } },
    ])

    expect(merged['root w - -']).toEqual([
      { ...e4, moduleIds: [7, 9] },
      { ...d4, moduleIds: [9] },
    ])
  })

  it('does not merge malformed edges whose UCI reaches different positions', () => {
    const merged = mergeRepertoireTrees([
      { moduleId: 1, tree: { 'root w - -': [{ san: 'e4', uci: 'e2e4', resultingFen: 'one b - -' }] } },
      { moduleId: 2, tree: { 'root w - -': [{ san: 'e4', uci: 'e2e4', resultingFen: 'two b - -' }] } },
    ])

    expect(merged['root w - -']).toHaveLength(2)
  })
})

describe('findMissingReleaseLines', () => {
  it('treats an exact path or a longer personal continuation as covered', () => {
    const makeLine = (id: string, ucis: string[]) => ({
      id,
      label: id,
      source: 'manual',
      sortOrder: 0,
      steps: ucis.map((uci) => ({ originFen: 'fen', san: uci, uci, resultingFen: 'next' })),
    })
    const lines = [makeLine('covered', ['e2e4', 'e7e5']), makeLine('missing', ['d2d4', 'd7d5'])]

    expect(findMissingReleaseLines(lines, ['e2e4 e7e5 g1f3']).map((line) => line.id)).toEqual(['missing'])
  })
})
