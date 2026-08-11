import { describe, expect, it } from 'vitest'
import { parsePgnLines, parsePgnLinesWithMetadata, parsePgnMovetext } from './pgnImport'
import { exportRepertoireToPgn } from './pgnExport'
import { addMoveToTree } from './repertoireTree'
import { START_FEN } from '../hooks/useGame'
import { normalizeFen } from './chessUtils'
import type { RepertoireTree } from '../types'

const ROOT = normalizeFen(START_FEN)

describe('parsePgnMovetext', () => {
  it('parses a linear line into one edge per ply', () => {
    const edges = parsePgnMovetext('1. e4 e5 2. Nf3 Nc6 *')
    expect(edges.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6'])
    expect(edges[0].originFen).toBe(ROOT)
    expect(edges[0].uci).toBe('e2e4')
    // Each edge's resultingFen chains into the next edge's originFen.
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i].originFen).toBe(edges[i - 1].resultingFen)
    }
  })

  it('ignores headers before the movetext', () => {
    const pgn = ['[Event "Test"]', '[Result "*"]', '', '1. e4 e5 *'].join('\n')
    expect(parsePgnMovetext(pgn).map((e) => e.san)).toEqual(['e4', 'e5'])
  })

  it('parses a variation into its own edges, branching from before the mainline move it replaces', () => {
    const edges = parsePgnMovetext('1. e4 e5 (1...c5 2. Nf3) 2. Nf3 *')
    const bySan = (san: string) => edges.filter((e) => e.san === san)

    expect(bySan('e5')).toHaveLength(1)
    expect(bySan('c5')).toHaveLength(1)
    // Both e5 and c5 are alternatives from the same position (after 1.e4).
    expect(bySan('c5')[0].originFen).toBe(bySan('e5')[0].originFen)
    // The mainline's 2.Nf3 (after e5) and the variation's 2.Nf3 (after c5) are
    // different edges, from different origins.
    expect(bySan('Nf3')).toHaveLength(2)
    expect(bySan('Nf3')[0].originFen).not.toBe(bySan('Nf3')[1].originFen)
  })

  it('handles a variation that starts on Black (ellipsis) and nested variations', () => {
    const edges = parsePgnMovetext('1. e4 (1. d4 d5 (1...Nf6 2. c4)) e5 *')
    expect(edges.map((e) => e.san).sort()).toEqual(['Nf6', 'd4', 'd5', 'e4', 'e5', 'c4'].sort())
    // 1...Nf6 is an alternative to 1...d5, both starting right after 1.d4.
    const d5 = edges.find((e) => e.san === 'd5')
    const nf6 = edges.find((e) => e.san === 'Nf6')
    expect(d5?.originFen).toBe(nf6?.originFen)
  })

  it('is tolerant of move numbers glued directly to the move with no space', () => {
    expect(parsePgnMovetext('1.e4 e5 2.Nf3 Nc6 *').map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6'])
  })

  it('skips comments and NAGs', () => {
    const edges = parsePgnMovetext('1. e4 {a good move} e5 $1 2. Nf3 *')
    expect(edges.map((e) => e.san)).toEqual(['e4', 'e5', 'Nf3'])
  })

  it('stops a branch at the first illegal/unparseable move without discarding earlier edges', () => {
    const edges = parsePgnMovetext('1. e4 e5 2. Qh9 Nc6 *')
    expect(edges.map((e) => e.san)).toEqual(['e4', 'e5'])
  })

  it('handles castling', () => {
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 *'
    const edges = parsePgnMovetext(pgn)
    expect(edges.map((e) => e.san)).toContain('O-O')
  })

  it('returns no edges for movetext with no moves', () => {
    expect(parsePgnMovetext('*')).toEqual([])
    expect(parsePgnMovetext('')).toEqual([])
  })

  it('normalizes originFen/resultingFen the same way the rest of the repertoire tree does', () => {
    const edges = parsePgnMovetext('1. e4 *')
    expect(edges[0].originFen).toBe(normalizeFen(edges[0].originFen))
    expect(edges[0].resultingFen).toBe(normalizeFen(edges[0].resultingFen))
  })

  it('round-trips a branching repertoire through export then reimport', () => {
    // Parse a PGN with a variation into edges, build a tree from them via the
    // same addMoveToTree the app itself uses, export that tree back to PGN, and
    // reimport it - the resulting edge set should match the original exactly
    // (order may differ, since RAV placement isn't the same as parse order).
    const pgn = '1. e4 e5 (1...c5 2. Nf3) 2. Nf3 Nc6 *'
    const edges = parsePgnMovetext(pgn)

    let tree: RepertoireTree = {}
    for (const edge of edges) {
      tree = addMoveToTree(tree, edge.originFen, { san: edge.san, uci: edge.uci, resultingFen: edge.resultingFen })
    }

    const reimported = parsePgnMovetext(exportRepertoireToPgn(tree, 'white'))

    const normalize = (list: typeof edges) => list.map((e) => `${e.originFen}|${e.san}|${e.resultingFen}`).sort()
    expect(normalize(reimported)).toEqual(normalize(edges))
  })
})

describe('parsePgnLines', () => {
  it('keeps PGN variations as distinct explicit root-to-leaf paths', () => {
    expect(parsePgnLines('1. e4 e5 (1...c5 2. Nf3) 2. Nf3 *').map((line) => line.map((edge) => edge.san))).toEqual([
      ['e4', 'e5', 'Nf3'],
      ['e4', 'c5', 'Nf3'],
    ])
  })

  it('restores a legacy opening-prep line label without treating its comment as moves', () => {
    const pgn = '1. e4 e5 {[%opening-prep-line e2e4%20e7e5|Vienna%3A%20main]} *'
    expect(parsePgnLinesWithMetadata(pgn)).toMatchObject([
      { label: 'Vienna: main', steps: [{ uci: 'e2e4' }, { uci: 'e7e5' }] },
    ])
  })

  it('captures standard comments and numeric annotation glyphs by ply', () => {
    const [line] = parsePgnLinesWithMetadata('1. e4 $1 {Controls the center} e5 $6 2. Nf3 *')
    expect(line.annotations).toEqual([
      { ply: 0, comment: 'Controls the center', nags: [1] },
      { ply: 1, nags: [6] },
    ])
  })

  it('captures semicolon comments and symbolic annotation glyphs', () => {
    const [line] = parsePgnLinesWithMetadata('1. e4! ; central space\ne5?! *')
    expect(line.annotations).toEqual([
      { ply: 0, comment: 'central space', nags: [1] },
      { ply: 1, nags: [6] },
    ])
  })
})
