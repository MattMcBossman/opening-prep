import { Chess } from 'chess.js'
import { normalizeFen } from './chessUtils'
import type { ExplorerResponse, RepertoireTree } from '../types'
import type { AuthUser } from './authApi'

export const TUTORIAL_USER: AuthUser = {
  id: -1,
  username: 'Kurtis · Tutorial',
  email: 'Tutorial account',
  lichessUsername: 'Kurtis on Lichess',
  chessComUsername: null,
}

const VIENNA_LINES = [
  ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4', 'd7d5'],
  ['e2e4', 'e7e5', 'b1c3', 'f8c5', 'f1c4', 'd7d6', 'd2d3'],
  ['e2e4', 'e7e5', 'b1c3', 'b8c6', 'f2f4', 'g8f6'],
]

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
