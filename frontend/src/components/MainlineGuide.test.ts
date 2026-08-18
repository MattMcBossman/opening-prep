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
    expect(WALKTHROUGH_STEPS[0].description).toBe(
      'Use the Explorer to browse openings and build lines, or switch to Drills to practice your saved repertoire.',
    )
    expect(WALKTHROUGH_STEPS.at(-2)?.description).toBe(
      'The Vienna Game opening module is loaded by default for this alpha deployment. Have fun, Kurtis.',
    )
    expect(WALKTHROUGH_STEPS.at(-2)).toMatchObject({ target: '[data-guide="walkthrough-vienna-module"]', manager: 'modules' })
    expect(WALKTHROUGH_STEPS.at(-1)?.title).toBe('Come back anytime')
    expect(WALKTHROUGH_STEPS[1].target).toBe('[data-guide="board"]')
    expect(WALKTHROUGH_STEPS[1].description).toMatch(/^Make a move on the board\./)
    expect(WALKTHROUGH_STEPS[2]).toMatchObject({
      title: 'View and edit saved lines',
      description: 'Review the lines saved in your selected opening module. Select any move to explore that position, or choose Edit to add, replace, and remove prepared lines.',
    })
    expect(WALKTHROUGH_STEPS[3].description).toBe(
      'Link a Lichess account to see opening statistics, popular continuations, and results for each position.',
    )
    expect(WALKTHROUGH_STEPS[4]).toMatchObject({
      title: 'Review your own games',
      description: 'Link a Lichess or Chess.com account to review your own game history.',
      source: 'my-games',
    })
  })

  it('labels coverage, recommendations, and end-of-drill analysis as experimental', () => {
    const coverage = WALKTHROUGH_STEPS.find((step) => step.target.includes('coverage'))
    const recommendations = WALKTHROUGH_STEPS.find((step) => step.target.includes('opening-generator'))
    const drill = WALKTHROUGH_STEPS.find((step) => step.target.includes('drill-workspace'))

    expect(coverage?.eyebrow).toBe('Experimental')
    expect(recommendations?.eyebrow).toBe('Experimental')
    expect(drill?.description).toContain('Experimental positional analysis appears at the end of each drill')
  })

  it('declares the required view for every step so Back restores it', () => {
    expect(WALKTHROUGH_STEPS.every((step) => step.mode === 'explorer' || step.mode === 'drill')).toBe(true)
  })
})
