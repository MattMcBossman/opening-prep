import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { START_FEN } from '../hooks/useGame'
import type { RepertoireTree } from '../types'
import { normalizeFen } from './chessUtils'
import { diffModuleDraft, isAuthoredPathPrefixSaved, moduleMoveDraftState } from './moduleDraftDiff'
import { addMoveToTree, removeMoveFromTree } from './repertoireTree'

function lineTree(uciMoves: string[]): RepertoireTree {
  const chess = new Chess(START_FEN)
  let tree: RepertoireTree = {}
  for (const uci of uciMoves) {
    const originFen = chess.fen()
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    tree = addMoveToTree(tree, originFen, {
      uci,
      san: move.san,
      resultingFen: normalizeFen(chess.fen()),
    })
  }
  return tree
}

describe('module draft diff', () => {
  it('distinguishes persisted, pending-added, and pending-removed moves', () => {
    const persisted = lineTree(['e2e4'])
    const withReply = lineTree(['e2e4', 'e7e5'])

    expect(moduleMoveDraftState(persisted, withReply, START_FEN, 'e2e4')).toBe('saved')
    expect(moduleMoveDraftState(persisted, withReply, Object.values(persisted)[0][0].resultingFen, 'e7e5')).toBe('pending-add')
    expect(moduleMoveDraftState(persisted, {}, START_FEN, 'e2e4')).toBe('pending-remove')
  })

  it('reports the final cascade result rather than an edit-operation count', () => {
    const persisted = lineTree(['e2e4', 'e7e5', 'g1f3'])
    const draft = removeMoveFromTree(persisted, 'white', START_FEN, 'e2e4')
    const diff = diffModuleDraft(persisted, draft, 'white')

    expect(diff.addedMoveCount).toBe(0)
    expect(diff.deletedMoveCount).toBe(3)
    expect(diff.addedLineCount).toBe(0)
    expect(diff.deletedLineCount).toBe(1)
    expect(diff.lines[0].changedFromPly).toBe(0)
  })

  it('marks only the changed suffix of an added line', () => {
    const persisted = lineTree(['e2e4', 'e7e5'])
    const draft = lineTree(['e2e4', 'e7e5', 'g1f3'])

    expect(diffModuleDraft(persisted, draft, 'white').lines).toMatchObject([
      { kind: 'add', changedFromPly: 2 },
    ])
  })

  it('marks only the removed suffix of a deleted line', () => {
    const persisted = lineTree(['e2e4', 'e7e5', 'g1f3'])
    const draft = lineTree(['e2e4', 'e7e5'])

    expect(diffModuleDraft(persisted, draft, 'white').lines).toMatchObject([
      { kind: 'delete', changedFromPly: 2 },
    ])
  })

  it('is empty when a draft returns to its persisted shape', () => {
    const persisted = lineTree(['e2e4', 'e7e5', 'g1f3'])
    expect(diffModuleDraft(persisted, structuredClone(persisted), 'white')).toMatchObject({
      moves: [], lines: [], addedMoveCount: 0, deletedMoveCount: 0,
    })
  })

  it('distinguishes authored move orders that share a transposition edge', () => {
    const path = 'g1f3 d7d5 d2d4 g8f6 c2c4 e7e6'
    expect(isAuthoredPathPrefixSaved([path], path.split(' '), 5)).toBe(true)
    expect(isAuthoredPathPrefixSaved(
      [path],
      ['d2d4', 'g8f6', 'g1f3', 'd7d5', 'c2c4', 'e7e6'],
      5,
    )).toBe(false)
  })

  it('treats a prefix of a longer authored continuation as saved', () => {
    const path = 'e2e4 e7e5 g1f3 b8c6'
    expect(isAuthoredPathPrefixSaved([path], path.split(' '), 2)).toBe(true)
  })
})
