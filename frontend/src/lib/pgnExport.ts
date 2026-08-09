import { START_FEN } from '../hooks/useGame'
import { normalizeFen } from './chessUtils'
import type { RepertoireColor, RepertoireTree } from '../types'

type Turn = 'w' | 'b'

/**
 * Pushes the PGN token(s) for one move, following the same move-number/ellipsis
 * convention as `formatMoveListFromPly` (see chessUtils.ts): White always gets a
 * leading "N." token; Black only gets a leading "N..." when it's the first token
 * of a fresh segment (the very start of the game, or right after an opening
 * paren) - every other Black move is just its bare SAN, since the preceding
 * tokens already establish the move order.
 */
function pushMoveToken(out: string[], moveNumber: number, turn: Turn, san: string, isSegmentStart: boolean): void {
  if (turn === 'w') {
    out.push(`${moveNumber}.`, san)
  } else if (isSegmentStart) {
    out.push(`${moveNumber}...${san}`)
  } else {
    out.push(san)
  }
}

function advance(moveNumber: number, turn: Turn): { moveNumber: number; turn: Turn } {
  return turn === 'w' ? { moveNumber, turn: 'b' } : { moveNumber: moveNumber + 1, turn: 'w' }
}

/**
 * Depth-first walk of the repertoire tree from `fen`, appending PGN movetext
 * tokens (plain move tokens and/or whole `(...)` variation strings) to `out`.
 *
 * The first saved move at each position (insertion order, as already stored -
 * see `addMoveToTree`) is treated as the mainline; every other saved move at
 * that position becomes its own nested `(...)` variation, recursively walked
 * the same way. Transpositions reached via a different line are expected to be
 * duplicated (see AGENTS.md) - the DFS naturally re-emits the shared subtree
 * under every parent that reaches it. `visited` guards only against a genuine
 * repetition *within the current path* (an ancestor FEN reappearing further
 * down the same line), which would otherwise recurse forever.
 */
function walk(
  tree: RepertoireTree,
  fen: string,
  moveNumber: number,
  turn: Turn,
  visited: ReadonlySet<string>,
  isSegmentStart: boolean,
  out: string[],
): void {
  const key = normalizeFen(fen)
  const edges = tree[key]
  if (!edges || edges.length === 0 || visited.has(key)) return

  const [mainMove, ...alternatives] = edges
  const pathVisited = new Set(visited)
  pathVisited.add(key)
  const next = advance(moveNumber, turn)

  pushMoveToken(out, moveNumber, turn, mainMove.san, isSegmentStart)

  for (const alt of alternatives) {
    if (pathVisited.has(normalizeFen(alt.resultingFen))) continue
    const variationTokens: string[] = []
    pushMoveToken(variationTokens, moveNumber, turn, alt.san, true)
    walk(tree, alt.resultingFen, next.moveNumber, next.turn, pathVisited, false, variationTokens)
    out.push(`(${variationTokens.join(' ')})`)
  }

  if (pathVisited.has(normalizeFen(mainMove.resultingFen))) return
  walk(tree, mainMove.resultingFen, next.moveNumber, next.turn, pathVisited, false, out)
}

function buildHeaders(color: RepertoireColor): string {
  const label = color === 'white' ? 'White' : 'Black'
  const tags: Array<[string, string]> = [
    ['Event', `opening-prep ${label} repertoire`],
    ['Site', '?'],
    ['Date', '????.??.??'],
    ['Round', '?'],
    ['White', '?'],
    ['Black', '?'],
    ['Result', '*'],
  ]
  return tags.map(([key, value]) => `[${key} "${value}"]`).join('\n')
}

/**
 * Exports `tree` (one color's repertoire) as PGN movetext with RAV variations
 * for every branch point, starting from the standard start position. Uses `*`
 * (unknown/no result) since this is prep, not a played game.
 */
export function exportRepertoireToPgn(tree: RepertoireTree, color: RepertoireColor): string {
  const out: string[] = []
  walk(tree, START_FEN, 1, 'w', new Set(), true, out)
  const movetext = out.join(' ')
  const body = movetext ? `${movetext} *` : '*'
  return `${buildHeaders(color)}\n\n${body}\n`
}
