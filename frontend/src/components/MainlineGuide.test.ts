import { describe, expect, it } from 'vitest'
import { WALKTHROUGH_STEPS, walkthroughSpotlightBounds } from './mainlineGuideData'

describe('walkthrough spotlight', () => {
  const edgeToEdgeTarget = { left: 0, top: 0, right: 390, bottom: 60 }

  it('reaches the viewport edges on mobile', () => {
    expect(walkthroughSpotlightBounds(edgeToEdgeTarget, 390, 844, true)).toEqual({
      left: 0,
      top: 0,
      right: 390,
      bottom: 66,
    })
  })

  it('retains the desktop viewport inset', () => {
    expect(walkthroughSpotlightBounds(edgeToEdgeTarget, 1200, 800, false)).toEqual({
      left: 6,
      top: 6,
      right: 396,
      bottom: 66,
    })
  })
})

describe('walkthrough content', () => {
  it('places the alpha Vienna note immediately before the final step', () => {
    expect(WALKTHROUGH_STEPS.at(-2)?.description).toBe(
      'The Vienna Game opening module is loaded by default for this alpha deployment. Have fun, Kurtis.',
    )
    expect(WALKTHROUGH_STEPS.at(-1)?.title).toBe('Come back anytime')
    expect(WALKTHROUGH_STEPS[1].description).toMatch(/^Make a move on the board\./)
  })

  it('labels coverage, recommendations, and end-of-drill analysis as experimental', () => {
    const coverage = WALKTHROUGH_STEPS.find((step) => step.target.includes('coverage-dashboard'))
    const recommendations = WALKTHROUGH_STEPS.find((step) => step.target.includes('opening-generator'))
    const drill = WALKTHROUGH_STEPS.find((step) => step.target.includes('drill-progress'))

    expect(coverage?.eyebrow).toBe('Experimental')
    expect(recommendations?.eyebrow).toBe('Experimental')
    expect(drill?.description).toContain('Experimental analysis')
  })
})
