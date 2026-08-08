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
}
