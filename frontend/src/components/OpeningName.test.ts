import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OpeningName } from './OpeningName'

describe('OpeningName', () => {
  it('never substitutes a module name for the Lichess classification', () => {
    const html = renderToStaticMarkup(createElement(OpeningName, {
      name: null, fen: 'position w - - 0 1',
    }))
    expect(html).toContain('Unclassified position')
    expect(html).not.toContain('Vienna Game')
  })

  it('shows loading instead of prematurely claiming that a name is unavailable', () => {
    const html = renderToStaticMarkup(createElement(OpeningName, {
      name: null, fen: 'position w - - 0 1', loading: true,
    }))
    expect(html).toContain('Loading opening')
    expect(html).not.toContain('unavailable')
  })

  it('does not display an ECO classification code', () => {
    const html = renderToStaticMarkup(createElement(OpeningName, {
      name: 'Vienna Game', fen: 'position w - - 0 1',
    }))
    expect(html).toContain('Vienna Game')
    expect(html).not.toContain('C25')
  })
})
