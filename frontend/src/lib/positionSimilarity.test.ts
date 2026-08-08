import { describe, expect, it } from 'vitest'
import {
  differingSquares,
  expandBoard,
  findNearestSimilarPosition,
  hammingDistance,
} from './positionSimilarity'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// 1. e4
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
// 1. d4 (same "shape" of change as 1. e4, just a different pawn/file)
const AFTER_D4_FEN = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1'

describe('expandBoard', () => {
  it('expands run-length-encoded empty squares into one entry per square', () => {
    const expanded = expandBoard(START_FEN)
    expect(expanded).toHaveLength(64)
    // Rank 8 (index 0-7): black back rank, no empty squares to expand.
    expect(expanded.slice(0, 8)).toEqual(['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'])
    // Rank 4 (index 24-31 in an all-empty starting position) should be all "1"s.
    expect(expanded.slice(24, 32)).toEqual(Array(8).fill('1'))
  })
})

describe('hammingDistance', () => {
  it('is 0 for identical piece placement', () => {
    expect(hammingDistance(START_FEN, START_FEN)).toBe(0)
  })

  it('counts exactly the squares that changed for a single pawn push', () => {
    // e2-e4 changes exactly two squares: e2 (was pawn, now empty) and e4 (was empty, now pawn).
    expect(hammingDistance(START_FEN, AFTER_E4_FEN)).toBe(2)
  })

  it('is symmetric', () => {
    expect(hammingDistance(START_FEN, AFTER_E4_FEN)).toBe(hammingDistance(AFTER_E4_FEN, START_FEN))
  })

  it('is larger for less similar positions than for more similar ones', () => {
    // AFTER_E4_FEN and AFTER_D4_FEN both differ from START_FEN by one pawn push each,
    // but from each other by two pawn pushes (four changed squares).
    const distanceToSelf = hammingDistance(START_FEN, AFTER_E4_FEN)
    const distanceBetweenPushes = hammingDistance(AFTER_E4_FEN, AFTER_D4_FEN)
    expect(distanceBetweenPushes).toBeGreaterThan(distanceToSelf)
  })
})

describe('differingSquares', () => {
  it('reports the specific squares that changed', () => {
    expect(differingSquares(START_FEN, AFTER_E4_FEN).sort()).toEqual(['e2', 'e4'])
  })
})

describe('findNearestSimilarPosition', () => {
  it('returns null when nothing is within the distance threshold', () => {
    expect(findNearestSimilarPosition(START_FEN, [AFTER_E4_FEN, AFTER_D4_FEN], 1)).toBeNull()
  })

  it('returns the closest candidate within the threshold, ignoring exact matches', () => {
    const farFen = 'rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1' // e2-e3, still 2 squares
    const match = findNearestSimilarPosition(AFTER_E4_FEN, [START_FEN, AFTER_E4_FEN, farFen], 4)
    expect(match).not.toBeNull()
    expect(match?.fen).toBe(START_FEN)
    expect(match?.distance).toBe(2)
    expect(match?.differingSquares.sort()).toEqual(['e2', 'e4'])
  })

  it('excludes an exact piece-placement match from the results', () => {
    const match = findNearestSimilarPosition(START_FEN, [START_FEN], 10)
    expect(match).toBeNull()
  })
})
