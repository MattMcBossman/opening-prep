import { describe, expect, it } from 'vitest'
import { parseLocalRepertoire, serializeLocalRepertoireV2 } from './useRepertoire'

const whiteTree = {
  'root w KQkq -': [{ san: 'e4', uci: 'e2e4', resultingFen: 'after b KQkq e3' }],
}

describe('anonymous repertoire storage migration', () => {
  it('reads the legacy v1 color-pair shape', () => {
    expect(parseLocalRepertoire({ white: whiteTree, black: {} })).toEqual({ white: whiteTree, black: {} })
  })

  it('round-trips the versioned Default profile and General modules', () => {
    const repertoire = { white: whiteTree, black: {} }
    const stored = serializeLocalRepertoireV2(repertoire)

    expect(stored.version).toBe(2)
    expect(stored.profiles[0].modules.map((module) => module.name)).toEqual(['General White', 'General Black'])
    expect(parseLocalRepertoire(stored)).toEqual(repertoire)
  })

  it('falls back safely for malformed storage', () => {
    expect(parseLocalRepertoire(null)).toEqual({ white: {}, black: {} })
    expect(parseLocalRepertoire({ version: 2, profiles: [] })).toEqual({ white: {}, black: {} })
  })
})
