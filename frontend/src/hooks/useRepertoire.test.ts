import { describe, expect, it } from 'vitest'
import { parseLocalRepertoire, selectAlphaViennaTemplate, serializeLocalRepertoireV2 } from './useRepertoire'
import type { OpeningTemplateSummary } from '../lib/repertoireApi'

const whiteTree = {
  'root w KQkq -': [{ san: 'e4', uci: 'e2e4', resultingFen: 'after b KQkq e3' }],
}

describe('anonymous repertoire storage migration', () => {
  it('reads the legacy v1 color-pair shape', () => {
    expect(parseLocalRepertoire({ white: whiteTree, black: {} })).toEqual({ white: whiteTree, black: {} })
  })

  it('round-trips the versioned Default profile and imported modules', () => {
    const repertoire = { white: whiteTree, black: {} }
    const stored = serializeLocalRepertoireV2(repertoire)

    expect(stored.version).toBe(2)
    expect(stored.profiles[0].modules.map((module) => module.name)).toEqual(['Imported White module', 'Imported Black module'])
    expect(parseLocalRepertoire(stored)).toEqual(repertoire)
  })

  it('falls back safely for malformed storage', () => {
    expect(parseLocalRepertoire(null)).toEqual({ white: {}, black: {} })
    expect(parseLocalRepertoire({ version: 2, profiles: [] })).toEqual({ white: {}, black: {} })
  })
})

describe('alpha Vienna default', () => {
  const template = (slug: string): OpeningTemplateSummary => ({
    slug,
    name: slug,
    description: '',
    color: 'white',
    kind: 'community',
    publisherName: 'Kurtis',
    latestRelease: { id: 1, version: 1, publishedAt: '', commonStart: '', lineCount: 1, moveCount: 1 },
  })

  it('prefers the authored Vienna over the development seed fallback', () => {
    expect(selectAlphaViennaTemplate([template('vienna-game'), template('vienna')])?.slug).toBe('vienna')
  })

  it('uses the starter seed only when the authored release is unavailable', () => {
    expect(selectAlphaViennaTemplate([template('stonewall-attack'), template('vienna-game')])?.slug).toBe('vienna-game')
    expect(selectAlphaViennaTemplate([template('stonewall-attack')])).toBeNull()
  })
})
