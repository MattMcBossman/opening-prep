import { describe, expect, it } from 'vitest'
import { BAD_MOVE_CP_THRESHOLD, classifyMoveQuality } from './moveQuality'

describe('classifyMoveQuality', () => {
  it('reports zero loss and not-bad when the eval is unchanged', () => {
    const result = classifyMoveQuality(
      { scoreType: 'cp', scoreValue: 30 },
      { scoreType: 'cp', scoreValue: 30 },
      'white',
    )
    expect(result.cpLoss).toBe(0)
    expect(result.isBad).toBe(false)
  })

  it('is not bad just below the threshold', () => {
    const result = classifyMoveQuality(
      { scoreType: 'cp', scoreValue: 40 },
      { scoreType: 'cp', scoreValue: -9 }, // 49 cp loss for White
      'white',
    )
    expect(result.cpLoss).toBe(49)
    expect(result.isBad).toBe(false)
  })

  it('is bad exactly at the threshold', () => {
    const result = classifyMoveQuality(
      { scoreType: 'cp', scoreValue: 40 },
      { scoreType: 'cp', scoreValue: -10 }, // exactly 50 cp loss for White
      'white',
      BAD_MOVE_CP_THRESHOLD,
    )
    expect(result.cpLoss).toBe(50)
    expect(result.isBad).toBe(true)
  })

  it('flips the comparison direction for Black, since scores are always White-relative', () => {
    // Black is the mover. Before: -40 (Black slightly better). After: 10 (White now
    // slightly better) - the score moved toward White by 50, a 50cp loss for Black.
    const result = classifyMoveQuality(
      { scoreType: 'cp', scoreValue: -40 },
      { scoreType: 'cp', scoreValue: 10 },
      'black',
    )
    expect(result.cpLoss).toBe(50)
    expect(result.isBad).toBe(true)
  })

  it('does not penalize a move that improves the mover\'s position', () => {
    const result = classifyMoveQuality(
      { scoreType: 'cp', scoreValue: 0 },
      { scoreType: 'cp', scoreValue: 80 },
      'white',
    )
    expect(result.cpLoss).toBeLessThan(0)
    expect(result.isBad).toBe(false)
  })

  it('treats losing a winning mate as decisively bad', () => {
    const result = classifyMoveQuality(
      { scoreType: 'mate', scoreValue: 3 }, // White had mate in 3
      { scoreType: 'cp', scoreValue: 0 }, // now equal
      'white',
    )
    expect(result.isBad).toBe(true)
  })

  it('treats walking into a losing mate as decisively bad', () => {
    const result = classifyMoveQuality(
      { scoreType: 'cp', scoreValue: 0 },
      { scoreType: 'mate', scoreValue: -2 }, // Black now has mate in 2
      'white',
    )
    expect(result.isBad).toBe(true)
  })
})
