export type ExplorerMoveStat = {
  san: string
  uci: string
  white: number
  draws: number
  black: number
  totalGames: number
  opening?: ExplorerOpening
}

export type ExplorerOpening = {
  eco: string
  name: string
} | null

export type ExplorerResponse = {
  totalGames: number
  moves: ExplorerMoveStat[]
  opening: ExplorerOpening
  /** Only ever set (and `true`) by the "my games" source - see fetchMyGamesExplorerStats. */
  stillIndexing?: boolean
  /** Lichess's indexing queue position; not a count of games remaining. */
  queuePosition?: number
  /** Browser-side personal-game import cooldown after an upstream 429. */
  gameExportRateLimit?: { source: 'lichess' | 'chesscom'; retryAt: number }
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

/**
 * The distinct audio cues played when a move is made. Ordered by precedence in
 * `classifyMoveSound`: a move can be several of these at once (a capture that gives
 * check, say), but only the most significant one is heard.
 */
export type MoveSound = 'move' | 'capture' | 'check' | 'checkmate'

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

export type AnalysisCandidate = {
  rank: number
  depth: number
  scoreType: 'cp' | 'mate'
  scoreValue: number
  bestMoveUci: string
  pvUci: string[]
}

export type RecurringAnalysisMove = {
  uci: string
  san: string
  side: RepertoireColor
  earliestPly: number
  latestPly: number
  lineCount: number
  totalLines: number
  timing: 'prepared' | 'mixed'
  prerequisiteLines: string[][]
  immediateCandidateRank: number | null
  immediateCentipawnLoss: number | null
}

export type PositionAnalysis = {
  fen: string
  engineVersion: string
  analysisProfile: string
  depth: number
  multiPv: number
  candidates: AnalysisCandidate[]
  recurringMoves: RecurringAnalysisMove[]
  updatedAt?: string
}

export type PositionFact = {
  id: string
  category: 'material' | 'pawns' | 'files' | 'activity' | 'king' | 'tactics'
  kind: string
  side: RepertoireColor | 'both'
  severity: 'info' | 'advantage' | 'weakness' | 'warning'
  confidence: 'certain' | 'high' | 'medium'
  summary: string
  squares: string[]
  pieces: string[]
  evidence: Record<string, unknown>
}

export type PositionFeatureSet = {
  fen: string
  schemaVersion: number
  extractorVersion: string
  facts: PositionFact[]
  checksum: string
  updatedAt: string
}

export type MoveFeatureComparison = {
  originFen: string
  moveUci: string
  moveSan: string
  resultingFen: string
  before: Omit<PositionFeatureSet, 'updatedAt'>
  after: Omit<PositionFeatureSet, 'updatedAt'>
  addedFacts: PositionFact[]
  removedFacts: PositionFact[]
}
