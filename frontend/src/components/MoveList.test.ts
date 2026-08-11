import { describe, expect, it } from 'vitest'
import { buildContinuationTree } from '../lib/continuationTree'
import type { RepertoireMove } from '../types'

const move = (san: string, uci: string, resultingFen: string): RepertoireMove => ({ san, uci, resultingFen })

describe('buildContinuationTree', () => {
  it('pairs one forced reply and preserves branching beneath it', () => {
    const tree = new Map<string, RepertoireMove[]>([
      ['root', [move('e4', 'e2e4', 'after-e4')]],
      ['after-e4', [move('e5', 'e7e5', 'after-e5')]],
      ['after-e5', [move('Nf3', 'g1f3', 'after-nf3'), move('Nc3', 'b1c3', 'after-nc3')]],
    ])

    const nodes = buildContinuationTree('root', 0, (fen) => tree.get(fen) ?? [])

    expect(nodes).toHaveLength(1)
    expect(nodes[0].chain.map((item) => item.move.san)).toEqual(['e4', 'e5'])
    expect(nodes[0].children.map((node) => node.chain[0].move.san)).toEqual(['Nf3', 'Nc3'])
    expect(nodes[0].leafCount).toBe(2)
    expect(nodes[0].childCount).toBe(2)
  })

  it('does not materialize collapsed descendants', () => {
    const tree = new Map<string, RepertoireMove[]>([
      ['root', [move('e4', 'e2e4', 'after-e4'), move('d4', 'd2d4', 'after-d4')]],
      ['after-e4', [move('c5', 'c7c5', 'after-c5'), move('e5', 'e7e5', 'after-e5')]],
      ['after-c5', [move('Nf3', 'g1f3', 'after-nf3')]],
    ])

    const nodes = buildContinuationTree('root', 0, (fen) => tree.get(fen) ?? [], () => false)

    expect(nodes).toHaveLength(2)
    expect(nodes[0].childCount).toBe(2)
    expect(nodes[0].children).toEqual([])
  })

  it('marks a repeated destination as a transposition instead of duplicating it', () => {
    const tree = new Map<string, RepertoireMove[]>([
      ['root', [move('Move A', 'a1a2', 'shared'), move('Move B', 'b1b2', 'shared')]],
    ])

    const nodes = buildContinuationTree('root', 0, (fen) => tree.get(fen) ?? [])

    expect(nodes[0].transposesTo).toBeUndefined()
    expect(nodes[1].transposesTo).toBe('Move A')
    expect(nodes[1].children).toEqual([])
  })

  it('bounds large trees so the Moves panel cannot exhaust a mobile browser', () => {
    const getContinuations = (fen: string): RepertoireMove[] => {
      const depth = fen === 'root' ? 0 : Number(fen.split('-')[0])
      if (depth >= 15) return []
      return [0, 1].map((branch) => move(`m${depth}${branch}`, `${depth}${branch}`, `${depth + 1}-${fen}-${branch}`))
    }

    const nodes = buildContinuationTree('root', 0, getContinuations)
    const flattened = (items: typeof nodes): typeof nodes => items.flatMap((node) => [node, ...flattened(node.children)])
    const allNodes = flattened(nodes)

    expect(allNodes.length).toBeLessThanOrEqual(10_000)
    expect(allNodes.some((node) => node.truncated)).toBe(true)
  })
})
