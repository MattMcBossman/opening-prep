import { normalizeFen } from './chessUtils'
import type { RepertoireMove } from '../types'

export type ContinuationTreeItem = {
  originFen: string
  move: RepertoireMove
  ply: number
}

export type ContinuationTreeNode = {
  key: string
  chain: ContinuationTreeItem[]
  children: ContinuationTreeNode[]
  transposesTo?: string
  cycle?: boolean
  truncated?: boolean
  leafCount: number
  childCount: number
}

const MAX_TREE_PLIES = 80
// The tree is presentation, not an export surface. A large composed profile can
// contain thousands of unique positions; eagerly materializing all of them made
// mobile browsers run out of memory shortly after repertoire loading completed.
const MAX_TREE_NODES = 10_000

function safeFenKey(fen: string): string {
  try {
    return normalizeFen(fen)
  } catch {
    return fen
  }
}

/** Builds a compact DAG view, pairing a forced reply with its preceding move. */
export function buildContinuationTree(
  rootFen: string,
  rootPly: number,
  getContinuations: (fen: string) => RepertoireMove[],
  shouldExpand: (key: string, depth: number) => boolean = () => true,
  forcedChainPlies = 2,
): ContinuationTreeNode[] {
  const seen = new Map<string, string>([[safeFenKey(rootFen), 'current position']])

  function countNodes(nodes: readonly ContinuationTreeNode[]): number {
    return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)
  }

  function build(originFen: string, ply: number, prefix: string[], ancestors: ReadonlySet<string>, budget: number, depth: number): ContinuationTreeNode[] {
    if (ply - rootPly >= MAX_TREE_PLIES || budget <= 0) return []
    const nodes: ContinuationTreeNode[] = []
    const candidates = getContinuations(originFen)
    let remainingBudget = budget
    for (let candidateIndex = 0; candidateIndex < candidates.length && remainingBudget > 0; candidateIndex += 1) {
      const firstMove = candidates[candidateIndex]
      // Divide the remaining work between sibling branches so a huge first
      // branch cannot hide every other immediate choice.
      const branchBudget = Math.max(1, Math.floor(remainingBudget / (candidates.length - candidateIndex)))
      const chain: ContinuationTreeItem[] = [{ originFen, move: firstMove, ply }]
      const path = [...prefix, firstMove.uci]
      let finalFen = firstMove.resultingFen
      let finalKey = safeFenKey(finalFen)
      let transposesTo = seen.get(finalKey)
      let cycle = ancestors.has(finalKey)
      let nextPly = ply + 1

      if (!transposesTo && !cycle) {
        seen.set(finalKey, chain.map((item) => item.move.san).join(' '))
        let forced = getContinuations(finalFen)
        while (forced.length === 1 && chain.length < forcedChainPlies && nextPly - rootPly < MAX_TREE_PLIES) {
          const reply = forced[0]
          chain.push({ originFen: finalFen, move: reply, ply: nextPly })
          path.push(reply.uci)
          finalFen = reply.resultingFen
          finalKey = safeFenKey(finalFen)
          transposesTo = seen.get(finalKey)
          cycle = ancestors.has(finalKey)
          nextPly += 1
          if (!transposesTo && !cycle) seen.set(finalKey, chain.map((item) => item.move.san).join(' '))
          if (transposesTo || cycle) break
          forced = getContinuations(finalFen)
        }
      }

      const nextAncestors = new Set(ancestors)
      for (const item of chain) nextAncestors.add(safeFenKey(item.originFen))
      const atLimit = nextPly - rootPly >= MAX_TREE_PLIES
      const childCount = transposesTo || cycle || atLimit ? 0 : getContinuations(finalFen).length
      const wantsChildren = childCount > 0 && shouldExpand(path.join(' '), depth)
      const children = !wantsChildren ? [] : build(finalFen, nextPly, path, nextAncestors, branchBudget - 1, depth + 1)
      const budgetCutOff = wantsChildren && children.length < childCount
      const leafCount = children.length > 0 ? children.reduce((sum, child) => sum + child.leafCount, 0) : 1
      nodes.push({
        key: path.join(' '),
        chain,
        children,
        transposesTo,
        cycle,
        truncated: (atLimit && getContinuations(finalFen).length > 0)
          || budgetCutOff
          || children.some((child) => child.truncated),
        leafCount,
        childCount,
      })
      remainingBudget -= 1 + countNodes(children)
    }
    return nodes
  }

  return build(rootFen, rootPly, [], new Set([safeFenKey(rootFen)]), MAX_TREE_NODES, 0)
}
