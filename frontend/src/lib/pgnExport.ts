import { START_FEN } from '../hooks/useGame'
import { normalizeFen } from './chessUtils'
import type { RepertoireColor, RepertoireTree } from '../types'

export type PgnExportLine = {
  uciPath: string
  label: string
  annotations?: Array<{ ply: number; comment?: string; nags?: number[] }>
}

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
  path: string[],
  labels: ReadonlyMap<string, ExportMetadata>,
): void {
  const key = normalizeFen(fen)
  const edges = tree[key]
  if (!edges || edges.length === 0 || visited.has(key)) return

  const [mainMove, ...alternatives] = edges
  const pathVisited = new Set(visited)
  pathVisited.add(key)
  const next = advance(moveNumber, turn)

  pushMoveToken(out, moveNumber, turn, mainMove.san, isSegmentStart)
  const mainPath = [...path, mainMove.uci]
  appendMoveAnnotations(out, mainPath, labels)

  for (const alt of alternatives) {
    if (pathVisited.has(normalizeFen(alt.resultingFen))) continue
    const variationTokens: string[] = []
    pushMoveToken(variationTokens, moveNumber, turn, alt.san, true)
    const altPath = [...path, alt.uci]
    appendMoveAnnotations(variationTokens, altPath, labels)
    walk(tree, alt.resultingFen, next.moveNumber, next.turn, pathVisited, false, variationTokens, altPath, labels)
    if (!tree[normalizeFen(alt.resultingFen)]?.length) appendLineLabel(variationTokens, altPath, labels)
    out.push(`(${variationTokens.join(' ')})`)
  }

  if (pathVisited.has(normalizeFen(mainMove.resultingFen))) return
  walk(tree, mainMove.resultingFen, next.moveNumber, next.turn, pathVisited, false, out, mainPath, labels)
  if (!tree[normalizeFen(mainMove.resultingFen)]?.length) appendLineLabel(out, mainPath, labels)
}

type ExportMetadata = { label: string; annotations: PgnExportLine['annotations'] }

function appendMoveAnnotations(out: string[], path: string[], metadata: ReadonlyMap<string, ExportMetadata>): void {
  const prefix = path.join(' ')
  const candidate = [...metadata.entries()].find(([uciPath]) => uciPath === prefix || uciPath.startsWith(`${prefix} `))
  const annotation = candidate?.[1].annotations?.find((item) => item.ply === path.length - 1)
  for (const nag of annotation?.nags ?? []) out.push(`$${nag}`)
  if (annotation?.comment) out.push(`{${annotation.comment.replaceAll('}', ']')}}`)
}

function appendLineLabel(out: string[], path: string[], labels: ReadonlyMap<string, ExportMetadata>): void {
  const uciPath = path.join(' ')
  const label = labels.get(uciPath)?.label
  if (label) out.push(`{[%opening-prep-line ${encodeURIComponent(uciPath)}|${encodeURIComponent(label)}]}`)
}

function buildHeaders(color: RepertoireColor): string {
  const label = color === 'white' ? 'White' : 'Black'
  const tags: Array<[string, string]> = [
    ['Event', `Mainline ${label} repertoire`],
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
export function exportRepertoireToPgn(tree: RepertoireTree, color: RepertoireColor, lines: PgnExportLine[] = []): string {
  const out: string[] = []
  const labels = new Map(lines.map((line) => [line.uciPath, { label: line.label, annotations: line.annotations }]))
  walk(tree, START_FEN, 1, 'w', new Set(), true, out, [], labels)
  const movetext = out.join(' ')
  const body = movetext ? `${movetext} *` : '*'
  return `${buildHeaders(color)}\n\n${body}\n`
}
