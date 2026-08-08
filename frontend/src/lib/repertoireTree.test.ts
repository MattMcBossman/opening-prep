import { describe, expect, it } from 'vitest'
import { addMoveToTree, isRepertoireEmpty, removeMoveFromTree } from './repertoireTree'
import type { RepertoireTree } from '../types'

const ROOT = 'root w - -'
const AFTER_E4 = 'after-e4 b - -'
const AFTER_E4_E5 = 'after-e4-e5 w - -'
const AFTER_D4 = 'after-d4 b - -'
const AFTER_D4_D5 = 'after-d4-d5 w - -'

describe('addMoveToTree', () => {
  it('adds a new edge under the normalized origin FEN', () => {
    const tree: RepertoireTree = {}
    const next = addMoveToTree(tree, ROOT, { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 })
    expect(next).toEqual({ [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }] })
  })

  it('appends to existing continuations from the same origin', () => {
    const tree: RepertoireTree = { [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }] }
    const next = addMoveToTree(tree, ROOT, { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 })
    expect(next[ROOT]).toHaveLength(2)
  })

  it('is a no-op (returns the same reference) when the edge is already saved', () => {
    const tree: RepertoireTree = { [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }] }
    const next = addMoveToTree(tree, ROOT, { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 })
    expect(next).toBe(tree)
  })
})

describe('removeMoveFromTree', () => {
  it('is a no-op (returns the same reference) when the origin position has no saved continuations at all', () => {
    const tree: RepertoireTree = { [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }] }
    // AFTER_E4 isn't a key in `tree` at all - distinct from "the origin exists but
    // doesn't have this particular uci", which still rebuilds the tree today (see
    // removeMoveFromTree's `!existing` guard).
    const next = removeMoveFromTree(tree, 'white', AFTER_E4, 'e7e5')
    expect(next).toBe(tree)
  })

  it('removes just the edge when siblings remain from the same origin', () => {
    const tree: RepertoireTree = {
      [ROOT]: [
        { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
        { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 },
      ],
    }
    const next = removeMoveFromTree(tree, 'white', ROOT, 'd2d4')
    expect(next[ROOT]).toEqual([{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }])
  })

  it('deletes the now-unreachable subtree beneath a removed edge', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    }
    const next = removeMoveFromTree(tree, 'white', ROOT, 'e2e4')
    expect(next[ROOT]).toBeUndefined()
    expect(next[AFTER_E4]).toBeUndefined()
  })

  it('keeps a subtree that is still reachable via a transposition into the same position', () => {
    // Both 1.e4 and 1.d4 lead (implausibly, but for test purposes) to the same
    // resulting position - removing one edge into it must not delete the shared
    // subtree, since the other edge still reaches it.
    const tree: RepertoireTree = {
      [ROOT]: [
        { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
        { san: 'd4', uci: 'd2d4', resultingFen: AFTER_E4 },
      ],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    }
    const next = removeMoveFromTree(tree, 'white', ROOT, 'e2e4')
    expect(next[ROOT]).toEqual([{ san: 'd4', uci: 'd2d4', resultingFen: AFTER_E4 }])
    expect(next[AFTER_E4]).toEqual([{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }])
  })

  it('prunes a now-responseless opponent reply exactly one step, without touching its own parent', () => {
    // White's repertoire: 1.e4 e5 2.Nf3. Removing 2.Nf3 leaves 1...e5 (Black's
    // reply) with no prepared response, so it should be pruned too - but 1.e4
    // (White's own move, one step further back) must survive.
    const AFTER_NF3 = 'after-nf3 b - -'
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
      [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
    }
    const next = removeMoveFromTree(tree, 'white', AFTER_E4_E5, 'g1f3')
    expect(next[AFTER_E4_E5]).toBeUndefined()
    // The opponent's reply into the now-childless AFTER_E4_E5 is pruned...
    expect(next[AFTER_E4]).toBeUndefined()
    // ...but White's own 1.e4 (a normal state with no reply prepped) is not.
    expect(next[ROOT]).toEqual([{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }])
  })

  it('does not prune the mirror case: an own move with no opponent reply prepped yet is left alone', () => {
    // Removing Black's only reply (d5) leaves AFTER_D4 (Black to move) childless,
    // but AFTER_D4 isn't White's own turn, so the pruning guard must not touch
    // White's d4 edge that leads there - it's a normal "no reply prepped yet"
    // state (see AGENTS.md), not something to prune.
    const tree: RepertoireTree = {
      [ROOT]: [
        { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
        { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 },
      ],
      [AFTER_D4]: [{ san: 'd5', uci: 'd7d5', resultingFen: AFTER_D4_D5 }],
    }
    const next = removeMoveFromTree(tree, 'white', AFTER_D4, 'd7d5')
    expect(next[AFTER_D4]).toBeUndefined()
    expect(next[ROOT]).toEqual(tree[ROOT])
  })
})

describe('isRepertoireEmpty', () => {
  it('is true for a tree with no saved positions', () => {
    expect(isRepertoireEmpty({})).toBe(true)
  })

  it('is false once anything is saved', () => {
    expect(isRepertoireEmpty({ [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }] })).toBe(false)
  })
})
