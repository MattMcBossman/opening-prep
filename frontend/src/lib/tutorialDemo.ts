import { Chess } from 'chess.js'
import { normalizeFen } from './chessUtils'
import type { ExplorerResponse, RepertoireTree } from '../types'

const VIENNA_LINES = [
  ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4', 'd7d5'],
  ['e2e4', 'e7e5', 'b1c3', 'f8c5', 'f1c4', 'd7d6', 'd2d3'],
  ['e2e4', 'e7e5', 'b1c3', 'b8c6', 'f2f4', 'g8f6'],
]

const TUTORIAL_OPENING_BY_PATH: Record<string, { eco: string; name: string }> = {
  e2e4: { eco: 'B00', name: "King's Pawn Game" },
  'e2e4 e7e5': { eco: 'C20', name: 'Open Game' },
  'e2e4 e7e5 b1c3': { eco: 'C25', name: 'Vienna Game' },
  'e2e4 e7e5 b1c3 g8f6': { eco: 'C25', name: 'Vienna Game, Falkbeer Variation' },
  'e2e4 e7e5 b1c3 g8f6 f2f4': { eco: 'C25', name: 'Vienna Gambit' },
  'e2e4 e7e5 b1c3 f8c5': { eco: 'C25', name: 'Vienna Game' },
  'e2e4 e7e5 b1c3 b8c6': { eco: 'C25', name: 'Vienna Game' },
}

const TUTORIAL_EXTRA_MOVES_BY_PATH: Record<string, string[]> = {
  e2e4: ['c7c5', 'e7e6', 'c7c6', 'd7d5', 'g7g6'],
  'e2e4 e7e5': ['g1f3', 'f1c4', 'f2f4', 'd2d4'],
  'e2e4 e7e5 b1c3': ['d7d6', 'f7f5', 'g7g6'],
  'e2e4 e7e5 b1c3 g8f6': ['g1f3', 'f1c4', 'd2d3', 'g2g3'],
  'e2e4 e7e5 b1c3 g8f6 f2f4': ['e5f4', 'b8c6', 'f8c5', 'd7d6'],
  'e2e4 e7e5 b1c3 f8c5': ['g1f3', 'f2f4', 'd2d3'],
  'e2e4 e7e5 b1c3 f8c5 f1c4': ['g8f6', 'b8c6', 'f7f5'],
  'e2e4 e7e5 b1c3 f8c5 f1c4 d7d6': ['g1f3', 'f2f4'],
  'e2e4 e7e5 b1c3 b8c6': ['g1f3', 'f1c4', 'd2d3'],
  'e2e4 e7e5 b1c3 b8c6 f2f4': ['e5f4', 'f8c5', 'd7d6'],
}

export function buildTutorialViennaTree(): RepertoireTree {
  const tree: RepertoireTree = {}
  for (const line of VIENNA_LINES) {
    const board = new Chess()
    for (const uci of line) {
      const originFen = normalizeFen(board.fen())
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
      if (!move) throw new Error(`Illegal tutorial move: ${uci}`)
      const edge = { san: move.san, uci, resultingFen: normalizeFen(board.fen()) }
      if (!(tree[originFen] ?? []).some((candidate) => candidate.uci === uci)) {
        tree[originFen] = [...(tree[originFen] ?? []), edge]
      }
    }
  }
  return tree
}

export const TUTORIAL_VIENNA_TREE = buildTutorialViennaTree()

export const TUTORIAL_LICHESS_STATS: ExplorerResponse = {
  totalGames: 8_742_631,
  opening: null,
  moves: [
    { san: 'e4', uci: 'e2e4', white: 1_706_421, draws: 1_187_339, black: 1_484_870, totalGames: 4_378_630 },
    { san: 'd4', uci: 'd2d4', white: 1_192_084, draws: 861_442, black: 1_008_317, totalGames: 3_061_843 },
    { san: 'Nf3', uci: 'g1f3', white: 311_205, draws: 220_184, black: 247_619, totalGames: 779_008 },
    { san: 'c4', uci: 'c2c4', white: 208_516, draws: 144_827, black: 169_807, totalGames: 523_150 },
  ],
}

function buildTutorialPositionStats(): Record<string, ExplorerResponse> {
  const positions: Record<string, ExplorerResponse> = {
    [normalizeFen(new Chess().fen())]: TUTORIAL_LICHESS_STATS,
  }
  VIENNA_LINES.forEach((line, lineIndex) => {
    const board = new Chess()
    line.forEach((uci, ply) => {
      const originFen = normalizeFen(board.fen())
      const result = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
      if (!result) throw new Error(`Illegal tutorial move: ${uci}`)
      if (ply === 0) return

      const sample = Math.max(18_000, Math.round(1_350_000 / (ply + 1) * (1 - lineIndex * 0.12)))
      const current = positions[originFen] ?? { totalGames: 0, moves: [], opening: TUTORIAL_OPENING_BY_PATH[line.slice(0, ply).join(' ')] ?? null }
      const existing = current.moves.find((move) => move.uci === uci)
      if (existing) {
        existing.white += Math.round(sample * 0.38)
        existing.draws += Math.round(sample * 0.28)
        existing.black += sample - Math.round(sample * 0.38) - Math.round(sample * 0.28)
        existing.totalGames += sample
      } else {
        const white = Math.round(sample * 0.38)
        const draws = Math.round(sample * 0.28)
        current.moves.push({ san: result.san, uci, white, draws, black: sample - white - draws, totalGames: sample })
      }
      current.totalGames += sample
      current.moves.sort((a, b) => b.totalGames - a.totalGames)
      positions[originFen] = current

      const destinationFen = normalizeFen(board.fen())
      positions[destinationFen] ??= {
        totalGames: 0,
        moves: [],
        opening: TUTORIAL_OPENING_BY_PATH[line.slice(0, ply + 1).join(' ')] ?? { eco: 'C25', name: 'Vienna Game' },
      }
    })
  })

  for (const [path, extraMoves] of Object.entries(TUTORIAL_EXTRA_MOVES_BY_PATH)) {
    const board = new Chess()
    for (const uci of path.split(' ')) {
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
    }
    const fen = normalizeFen(board.fen())
    const current = positions[fen]
    if (!current) continue
    extraMoves.forEach((uci, index) => {
      if (current.moves.some((move) => move.uci === uci)) return
      const trial = new Chess(board.fen())
      const result = trial.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
      if (!result) throw new Error(`Illegal tutorial explorer move after ${path}: ${uci}`)
      const sample = Math.max(4_000, Math.round((current.moves[0]?.totalGames ?? 80_000) * (0.52 - index * 0.08)))
      const white = Math.round(sample * (0.36 + (index % 2) * 0.03))
      const draws = Math.round(sample * 0.29)
      current.moves.push({ san: result.san, uci, white, draws, black: sample - white - draws, totalGames: sample })
      current.totalGames += sample
    })
    current.moves.sort((a, b) => b.totalGames - a.totalGames)
  }
  return positions
}

const TUTORIAL_POSITION_STATS = buildTutorialPositionStats()

export function tutorialPositionStats(fen: string): ExplorerResponse {
  return TUTORIAL_POSITION_STATS[normalizeFen(fen)] ?? { totalGames: 0, moves: [], opening: null }
}

export function tutorialPersonalGameStats(fen: string): ExplorerResponse {
  const normalized = normalizeFen(fen)
  const publicStats = tutorialPositionStats(normalized)
  const seed = [...normalized].reduce((total, character) => total + character.charCodeAt(0), 0)
  const moves = publicStats.moves.slice(0, 5).map((move, index) => {
    const totalGames = Math.max(2, 18 - index * 3 + (seed + index * 5) % 4)
    const white = Math.max(1, Math.round(totalGames * (0.42 + ((seed + index) % 3) * 0.04)))
    const draws = Math.max(0, Math.round(totalGames * 0.18))
    return { ...move, white, draws, black: Math.max(0, totalGames - white - draws), totalGames }
  })
  return {
    totalGames: moves.reduce((total, move) => total + move.totalGames, 0),
    moves,
    opening: publicStats.opening,
  }
}
