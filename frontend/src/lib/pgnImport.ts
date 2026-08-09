import { Chess } from 'chess.js'
import { START_FEN } from '../hooks/useGame'
import { normalizeFen } from './chessUtils'

export type ParsedPgnEdge = {
  originFen: string
  san: string
  uci: string
  resultingFen: string
}

type Token = { type: 'move'; value: string } | { type: 'open' } | { type: 'close' } | { type: 'result' }

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
      i = end === -1 ? n : end + 1
      continue
    }
    if (ch === ';') {
      const end = movetext.indexOf('\n', i + 1)
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
      while (i < n && /[0-9]/.test(movetext[i])) i += 1
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
    tokens.push({ type: 'move', value: glued ? glued[1] : word })
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
