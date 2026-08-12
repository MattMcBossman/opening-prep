import { describe, expect, it } from 'vitest'
import { derivedLichessOpeningName, inheritedOpeningName, OPENING_NAME_GUARANTEE_MIN_GAMES } from './openingName'

describe('derivedLichessOpeningName', () => {
  it('extends the deepest Lichess name with the intervening move history', () => {
    expect(derivedLichessOpeningName('Sicilian Defense', 7, ['Nc6', 'h4']))
      .toBe('Sicilian Defense, 4... Nc6 5. h4')
  })

  it('defines the initial public-Lichess naming guarantee threshold', () => {
    expect(OPENING_NAME_GUARANTEE_MIN_GAMES).toBe(50_000)
  })

  it('inherits a native ancestor unchanged when no intermediate position needs a unique name', () => {
    expect(inheritedOpeningName('Sicilian Defense', 7, null, []))
      .toBe('Sicilian Defense')
  })

  it('inherits the ancestor-plus-moves name of the deepest guaranteed position', () => {
    expect(inheritedOpeningName('Sicilian Defense', 7, 9, ['Nc6', 'h4']))
      .toBe('Sicilian Defense, 4... Nc6 5. h4')
  })
})
