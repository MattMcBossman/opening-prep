import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { classifyMoveSound } from './moveSounds'

/** Plays `sans` from the start position and returns the SAN chess.js produced for the last one. */
function sanAfter(sans: string[]): string {
  const chess = new Chess()
  let last = ''
  for (const san of sans) {
    last = chess.move(san).san
  }
  return last
}

describe('classifyMoveSound', () => {
  it('treats a plain move as a regular move', () => {
    expect(classifyMoveSound('e4')).toBe('move')
    expect(classifyMoveSound('Nf3')).toBe('move')
    expect(classifyMoveSound('O-O')).toBe('move')
    expect(classifyMoveSound('e8=Q')).toBe('move')
  })

  it('detects captures', () => {
    expect(classifyMoveSound('exd5')).toBe('capture')
    expect(classifyMoveSound('Nxe5')).toBe('capture')
    expect(classifyMoveSound('Raxd1')).toBe('capture')
    expect(classifyMoveSound('bxa8=Q')).toBe('capture')
  })

  it('detects check', () => {
    expect(classifyMoveSound('Qh5+')).toBe('check')
    expect(classifyMoveSound('O-O-O+')).toBe('check')
  })

  it('detects checkmate', () => {
    expect(classifyMoveSound('Qxf7#')).toBe('checkmate')
    expect(classifyMoveSound('Ra8#')).toBe('checkmate')
  })

  it('prefers the most significant cue when a move is several at once', () => {
    // A capture that also gives check should sound like check, not a capture...
    expect(classifyMoveSound('Nxe5+')).toBe('check')
    // ...and a capture that delivers mate should sound like mate, not either.
    expect(classifyMoveSound('Qxf7#')).toBe('checkmate')
  })

  it('matches the SAN chess.js actually produces', () => {
    // Scholar's mate: the final move is a capture that is also checkmate.
    expect(sanAfter(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7'])).toBe('Qxf7#')
    expect(classifyMoveSound(sanAfter(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7']))).toBe('checkmate')

    // Fool's mate ends in a plain (non-capturing) checkmate.
    expect(classifyMoveSound(sanAfter(['f3', 'e5', 'g4', 'Qh4']))).toBe('checkmate')

    // En passant is written with an "x", so it sounds like the capture it is.
    expect(classifyMoveSound(sanAfter(['e4', 'Nf6', 'e5', 'd5', 'exd6']))).toBe('capture')
  })
})
