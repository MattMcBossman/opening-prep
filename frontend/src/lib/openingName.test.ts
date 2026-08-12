import { describe, expect, it } from 'vitest'
import { derivedLichessOpeningName, OPENING_NAME_GUARANTEE_MIN_GAMES } from './openingName'

describe('derivedLichessOpeningName', () => {
  it('extends the deepest Lichess name with the intervening move history', () => {
    expect(derivedLichessOpeningName('Sicilian Defense', 7, ['Nc6', 'h4']))
      .toBe('Sicilian Defense, 4... Nc6 5. h4')
  })

  it('defines the initial public-Lichess naming guarantee threshold', () => {
    expect(OPENING_NAME_GUARANTEE_MIN_GAMES).toBe(10_000)
  })
})
