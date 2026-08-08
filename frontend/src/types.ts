export type ExplorerMoveStat = {
  san: string
  uci: string
  white: number
  draws: number
  black: number
  totalGames: number
}

export type ExplorerOpening = {
  eco: string
  name: string
} | null

export type ExplorerResponse = {
  totalGames: number
  moves: ExplorerMoveStat[]
  opening: ExplorerOpening
}

export type RepertoireColor = 'white' | 'black'

export type RepertoireMove = {
  san: string
  uci: string
  /** Normalized FEN (see normalizeFen) of the position reached by this move. */
  resultingFen: string
}

/** A repertoire tree for one color: normalized origin FEN -> saved moves from that position. */
export type RepertoireTree = Record<string, RepertoireMove[]>

export type Repertoire = {
  white: RepertoireTree
  black: RepertoireTree
}

export type EngineEvaluation = {
  /** FEN this evaluation was computed for, so consumers can convert the PV to SAN safely. */
  fen: string
  depth: number
  scoreType: 'cp' | 'mate'
  /** Score from White's perspective: positive means White is better. */
  scoreValue: number
  bestMoveUci: string | null
  pvUci: string[]
  /** True while the engine is still searching (more `info` lines may arrive); false once `bestmove` is received. */
  thinking: boolean
  /**
   * True only when `fen` is already checkmate (no engine search happened — see
   * useEngineEval). Distinguishes "the game is already over" from a `mate` score
   * reported by the engine mid-search, which means "forced mate in N more plies".
   */
  terminal?: boolean
}
