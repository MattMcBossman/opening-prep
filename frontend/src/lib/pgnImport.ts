import { Chess } from 'chess.js'
import { START_FEN } from '../hooks/useGame'
import { normalizeFen } from './chessUtils'

export type ParsedPgnEdge = {
  originFen: string
  san: string
  uci: string
  resultingFen: string
  comment?: string
  nags?: number[]
}
export type ParsedPgnLine = {
  steps: ParsedPgnEdge[]
  label: string
  annotations: Array<{ ply: number; comment?: string; nags?: number[] }>
}

type Token =
  | { type: 'move'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'nag'; value: number }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'result' }

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*'])

/**
 * Strips PGN header tags (`[Tag "value"]` lines, plus any blank lines around
 * them) from the front of the text, returning just the movetext section.
 * Headers carry no information the importer needs - the repertoire's root is
 * always the standard start position (see `START_FEN`).
 */
function stripHeaders(pgn: string): string {
  const lines = pgn.split(/\r?\n/)
  let i = 0
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('['))) {
    i += 1
  }
  return lines.slice(i).join('\n')
}

/**
 * Tokenizes PGN movetext into move/open-paren/close-paren/result tokens.
 *
 * Move-number tokens (e.g. "12.", "12...", or a bare "12") are recognized and
 * discarded - `parseSequence` tracks the position itself via chess.js, so
 * they carry no information beyond a human-readable label. `{...}` comments,
 * `;` rest-of-line comments, and `$n` NAGs are skipped entirely - none of
 * these round-trip in v1 (see the PGN import/export plan).
 */
function tokenize(movetext: string): Token[] {
  const tokens: Token[] = []
  const n = movetext.length
  let i = 0
  while (i < n) {
    const ch = movetext[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '{') {
      const end = movetext.indexOf('}', i + 1)
      const value = movetext.slice(i + 1, end === -1 ? n : end).trim()
      if (!value.startsWith('[%opening-prep-line ')) tokens.push({ type: 'comment', value })
      i = end === -1 ? n : end + 1
      continue
    }
    if (ch === ';') {
      const end = movetext.indexOf('\n', i + 1)
      tokens.push({ type: 'comment', value: movetext.slice(i + 1, end === -1 ? n : end).trim() })
      i = end === -1 ? n : end + 1
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'open' })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'close' })
      i += 1
      continue
    }
    if (ch === '$') {
      i += 1
      const start = i
      while (i < n && /[0-9]/.test(movetext[i])) i += 1
      if (i > start) tokens.push({ type: 'nag', value: Number(movetext.slice(start, i)) })
      continue
    }
    let j = i
    while (j < n && !/[\s(){};]/.test(movetext[j])) j += 1
    const word = movetext.slice(i, j)
    i = j
    if (word === '') {
      i += 1 // Defensive: never spin forever on an unexpected character.
      continue
    }
    if (RESULT_TOKENS.has(word)) {
      tokens.push({ type: 'result' })
      continue
    }
    // A pure move-number token (just digits and dots) - discard.
    if (/^\d+\.*$/.test(word)) continue
    // A move number glued directly onto a SAN move with no space (e.g.
    // "12.Nf3", "12...Nf3") - keep only the SAN part. Requires at least one
    // literal dot after the digits so this can't misfire on castling written
    // as "0-0"/"0-0-0" (digits with a dash, no dot), which falls through to
    // the plain-move case below and is handled by chess.js's own move parser.
    const glued = word.match(/^\d+\.+([A-Za-zO].*)$/)
    const moveWord = glued ? glued[1] : word
    const symbolic = moveWord.match(/^(.*?)(!!|\?\?|!\?|\?!|!|\?)$/)
    tokens.push({ type: 'move', value: symbolic ? symbolic[1] : moveWord })
    if (symbolic) {
      const nag = ({ '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 } as Record<string, number>)[symbolic[2]]
      tokens.push({ type: 'nag', value: nag })
    }
  }
  return tokens
}

/**
 * Recursive-descent walk over `tokens` starting at `cursor.pos`, playing
 * moves from `startFen` on a fresh `Chess` instance and recording one
 * `ParsedPgnEdge` per move (mainline or variation) into `out`. Returns having
 * consumed up to (but not including) a `)` that closes this call's own
 * variation, a `result` token, or end of input.
 *
 * A `(...)` group always replaces the immediately preceding move in the
 * *enclosing* sequence, per standard RAV semantics - not a continuation of
 * it - so each one is parsed as its own fresh sequence starting from the
 * position just before that move (tracked here as `beforeMoveFen`), leaving
 * this sequence's own `chess` instance untouched.
 */
function parseSequence(tokens: Token[], cursor: { pos: number }, startFen: string, out: ParsedPgnEdge[]): void {
  const chess = new Chess(startFen)
  let beforeMoveFen = startFen
  let lastEdgeIndex: number | null = null

  while (cursor.pos < tokens.length) {
    const token = tokens[cursor.pos]
    if (token.type === 'close' || token.type === 'result') return

    if (token.type === 'open') {
      cursor.pos += 1
      parseSequence(tokens, cursor, beforeMoveFen, out)
      if (cursor.pos < tokens.length && tokens[cursor.pos].type === 'close') {
        cursor.pos += 1
      }
      continue
    }

    if (token.type === 'comment' || token.type === 'nag') {
      cursor.pos += 1
      if (lastEdgeIndex !== null) {
        const edge = out[lastEdgeIndex]
        if (token.type === 'comment') edge.comment = edge.comment ? `${edge.comment}\n${token.value}` : token.value
        else edge.nags = [...(edge.nags ?? []), token.value]
      }
      continue
    }

    beforeMoveFen = chess.fen()
    cursor.pos += 1
    let move
    try {
      move = chess.move(token.value)
    } catch {
      // Unparseable/illegal SAN - stop this sequence here rather than
      // throwing, so one bad token doesn't discard everything already
      // parsed (from this sequence or any sibling/ancestor one).
      return
    }
    // Normalized (see normalizeFen) to match how RepertoireMove.resultingFen
    // is always stored elsewhere (e.g. App.tsx's onTogglePlySaved) - several
    // tree operations (deleteOrphanedSubtree's reachability check,
    // denormalizeFen) compare/read it directly rather than re-normalizing.
    out.push({
      originFen: normalizeFen(beforeMoveFen),
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      resultingFen: normalizeFen(chess.fen()),
    })
    lastEdgeIndex = out.length - 1
  }
}

/**
 * Parses a PGN's movetext (with or without RAV variations) into a flat list
 * of edges, each independently ready for `addMove` - order doesn't matter to
 * callers, since every edge carries its own origin/resulting FEN and
 * `addMove`/`addMoveToTree` are idempotent per edge. A transposition reached
 * two different ways in the source PGN naturally merges here for free: both
 * occurrences produce an edge keyed by the same (already normalized-by-
 * `addMove`) origin FEN, exactly as if they'd been entered by hand.
 */
export function parsePgnMovetext(pgn: string): ParsedPgnEdge[] {
  const tokens = tokenize(stripHeaders(pgn))
  const out: ParsedPgnEdge[] = []
  parseSequence(tokens, { pos: 0 }, START_FEN, out)
  return out
}

/** Reconstructs stable root-to-leaf authored paths from imported PGN edges. */
export function parsePgnLines(pgn: string): ParsedPgnEdge[][] {
  const edges = parsePgnMovetext(pgn)
  const byOrigin = new Map<string, ParsedPgnEdge[]>()
  for (const edge of edges) {
    const siblings = byOrigin.get(edge.originFen) ?? []
    if (!siblings.some((candidate) => candidate.uci === edge.uci)) siblings.push(edge)
    byOrigin.set(edge.originFen, siblings)
  }
  const lines: ParsedPgnEdge[][] = []
  const walk = (fen: string, path: ParsedPgnEdge[], visited: ReadonlySet<string>) => {
    const continuations = byOrigin.get(normalizeFen(fen)) ?? []
    if (continuations.length === 0) {
      if (path.length > 0) lines.push(path)
      return
    }
    for (const edge of continuations) {
      if (visited.has(edge.resultingFen)) continue
      walk(edge.resultingFen, [...path, edge], new Set(visited).add(edge.originFen))
    }
  }
  walk(START_FEN, [], new Set())
  return lines
}

export function parsePgnLinesWithMetadata(pgn: string): ParsedPgnLine[] {
  const labels = new Map<string, string>()
  const pattern = /\{\[%opening-prep-line\s+([^|\]}]+)\|([^\]}]*)\]\}/g
  for (const match of pgn.matchAll(pattern)) {
    try {
      labels.set(decodeURIComponent(match[1]), decodeURIComponent(match[2]))
    } catch {
      // Ignore malformed custom metadata while retaining the legal moves.
    }
  }
  return parsePgnLines(pgn).map((steps) => ({
    steps,
    label: labels.get(steps.map((step) => step.uci).join(' ')) ?? '',
    annotations: steps.flatMap((step, ply) =>
      step.comment || step.nags?.length ? [{ ply, ...(step.comment ? { comment: step.comment } : {}), ...(step.nags?.length ? { nags: step.nags } : {}) }] : [],
    ),
  }))
}
