import { describe, expect, it } from 'vitest'
import { generatedLineLabel, generatedLineSegments } from '../lib/generatedLineLabel'

describe('generatedLineLabel', () => {
  it('normalizes king-to-rook castling notation without crashing', () => {
    expect(generatedLineLabel([
      'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6',
      'e1h1', 'f8e7', 'f1e1', 'e8h8',
    ])).toContain('O-O')
  })

  it('falls back to raw notation for an invalid partial path', () => {
    expect(generatedLineLabel(['e8h8'])).toBe('1. e8h8')
  })

  it('separates the starting path from generated moves', () => {
    expect(generatedLineSegments(['e2e4', 'e7e5', 'g1f3'], 2)).toEqual({
      starting: '1. e4 e5',
      added: '2. Nf3',
    })
  })
})
