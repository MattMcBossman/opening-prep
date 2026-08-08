import type { DrillLine, DrillStep } from './repertoireDrills'
import type { EngineEvaluation, RepertoireMove } from '../types'

export type DrillOutcome = 'perfect' | 'failed'

export type DrillFeedback =
  | { kind: 'correct' }
  | {
      /**
       * The played move IS a saved continuation, but every line it could lead to
       * has already been completed this session - see "Handling multiple saved
       * options" in the Phase 3 plan. Rejected without being applied and without
       * counting as a mistake, so the user is nudged toward the still-pending
       * branch instead.
       */
      kind: 'alreadyDrilled'
      playedSan: string
      playedUci: string
    }
  | {
      kind: 'wrong'
      /** Correlates an async engine classification result back to the attempt that triggered it. */
      attemptToken: number
      attemptNumber: number
      playedSan: string
      playedUci: string
      originFen: string
      resultingFen: string
      /** Filled in once the (async) engine comparison resolves - see useDrillSession. */
      cpLoss?: number
      isBad?: boolean
      bestResponseLine?: EngineEvaluation
      /** Origin square of a saved move, shown starting at the 2nd wrong attempt. */
      hintFrom?: string
      /** Destination square of a saved move, shown starting at the 3rd+ wrong attempt. */
      hintTo?: string
    }

export type DrillSessionState = {
  lines: DrillLine[]
  linesById: Map<string, DrillLine>
  /** Presentation order of line ids - reshuffleable via shuffleUpcoming(). */
  order: string[]
  pendingIds: Set<string>
  results: Record<string, DrillOutcome>
  rootFen: string
  /** The line this occurrence nominally aims to complete - see "targeting" in the Phase 3 plan. */
  currentTargetId: string | null
  currentFen: string
  /** Steps actually taken so far this occurrence (both own and auto-played opponent moves). */
  playedSteps: DrillStep[]
  /**
   * Steps the most recent attempt actually put on the board: the accepted own move
   * plus any opponent replies auto-played after it, in order. Empty for an attempt
   * that was rejected (wrong, or `alreadyDrilled`), since those are never applied.
   *
   * Unlike `playedSteps` this survives an occurrence completing, so callers can
   * still react to the move that finished a line - see useDrillSession, which uses
   * it to sound each move that lands on the board.
   */
  lastAppliedSteps: DrillStep[]
  /** Wrong-attempt count at `currentFen`, resets whenever the position changes. */
  wrongAttempts: number
  /** Whether *any* wrong attempt has occurred anywhere in this occurrence - determines perfect vs. failed. */
  hasWrongAttemptThisOccurrence: boolean
  lastFeedback: DrillFeedback | null
  nextAttemptToken: number
}

export function isSessionComplete(state: DrillSessionState): boolean {
  return state.pendingIds.size === 0
}

export function currentTargetLine(state: DrillSessionState): DrillLine | null {
  return state.currentTargetId ? state.linesById.get(state.currentTargetId) ?? null : null
}

export function createDrillSession(lines: DrillLine[], rootFen: string, order?: string[]): DrillSessionState {
  const resolvedOrder = order ?? lines.map((l) => l.id)
  const base: DrillSessionState = {
    lines,
    linesById: new Map(lines.map((l) => [l.id, l])),
    order: resolvedOrder,
    pendingIds: new Set(resolvedOrder),
    results: {},
    rootFen,
    currentTargetId: null,
    currentFen: rootFen,
    playedSteps: [],
    lastAppliedSteps: [],
    wrongAttempts: 0,
    hasWrongAttemptThisOccurrence: false,
    lastFeedback: null,
    nextAttemptToken: 0,
  }
  return beginNextOccurrence(base)
}

function beginNextOccurrence(state: DrillSessionState): DrillSessionState {
  const nextId = state.order.find((id) => state.pendingIds.has(id)) ?? null
  return {
    ...state,
    currentTargetId: nextId,
    currentFen: state.rootFen,
    playedSteps: [],
    wrongAttempts: 0,
    hasWrongAttemptThisOccurrence: false,
    lastFeedback: null,
  }
}

function matchesPrefix(line: DrillLine, playedSteps: DrillStep[]): boolean {
  if (line.steps.length < playedSteps.length) return false
  return playedSteps.every((step, i) => line.steps[i].uci === step.uci)
}

/** The (still-pending) line id whose steps so far match `playedSteps`, if any. */
function pendingMatchId(state: DrillSessionState, playedSteps: DrillStep[]): string | null {
  return (
    state.order.find(
      (id) => state.pendingIds.has(id) && matchesPrefix(state.linesById.get(id) as DrillLine, playedSteps),
    ) ?? null
  )
}

/** Any (pending or already-resolved) line id whose steps so far match `playedSteps`, if any. */
function anyMatchId(state: DrillSessionState, playedSteps: DrillStep[]): string | null {
  return state.order.find((id) => matchesPrefix(state.linesById.get(id) as DrillLine, playedSteps)) ?? null
}

/**
 * Picks which line this occurrence should be considered to be walking, given the
 * steps actually played so far. Keeps the current target if it's still
 * consistent; otherwise this is a "redirect" (the user played a different but
 * valid saved move) - prefer re-targeting onto a still-pending line so the
 * deviation makes progress, falling back to an already-resolved line (extra
 * reps) only if no pending line matches. Returns null only if nothing matches at
 * all, which shouldn't happen for a move that came from the same repertoire the
 * lines were enumerated from.
 */
function retarget(state: DrillSessionState, playedSteps: DrillStep[]): string | null {
  const current = state.currentTargetId ? state.linesById.get(state.currentTargetId) : undefined
  if (current && matchesPrefix(current, playedSteps)) return state.currentTargetId as string
  return pendingMatchId(state, playedSteps) ?? anyMatchId(state, playedSteps)
}

/**
 * Advances past however many auto-played opponent replies follow, per the
 * current target line, until either a leaf is reached (occurrence complete) or
 * it's the user's turn again.
 *
 * `applied` accumulates every step this attempt puts on the board, starting with
 * the accepted own move, so it can be recorded on the resulting state even in the
 * completion case, where `playedSteps` is reset back to empty.
 */
function advance(state: DrillSessionState, playedSteps: DrillStep[], applied: DrillStep[]): DrillSessionState {
  const targetLine = state.currentTargetId ? state.linesById.get(state.currentTargetId) : undefined
  if (!targetLine || playedSteps.length >= targetLine.steps.length) {
    return completeOccurrence({ ...state, lastAppliedSteps: applied }, state.currentTargetId)
  }
  const nextStep = targetLine.steps[playedSteps.length]
  if (nextStep.mover === 'own') {
    return {
      ...state,
      playedSteps,
      lastAppliedSteps: applied,
      currentFen: nextStep.fen,
      wrongAttempts: 0,
      lastFeedback: { kind: 'correct' },
    }
  }
  return advance(state, [...playedSteps, nextStep], [...applied, nextStep])
}

function completeOccurrence(state: DrillSessionState, targetId: string | null): DrillSessionState {
  if (!targetId) return beginNextOccurrence(state)
  const outcome: DrillOutcome = state.hasWrongAttemptThisOccurrence ? 'failed' : 'perfect'
  const pendingIds = new Set(state.pendingIds)
  pendingIds.delete(targetId)
  const results = { ...state.results, [targetId]: outcome }
  const next = beginNextOccurrence({ ...state, pendingIds, results })
  // beginNextOccurrence resets lastFeedback for the *new* occurrence it sets up, but
  // the move that just got us here was itself correct - preserve that so callers see
  // positive feedback for the move that completed the line, not a blank slate.
  return { ...next, lastFeedback: { kind: 'correct' } }
}

function hintMoveFor(
  state: DrillSessionState,
  getContinuations: (fen: string) => RepertoireMove[],
): RepertoireMove | undefined {
  const targetLine = state.currentTargetId ? state.linesById.get(state.currentTargetId) : undefined
  const designated = targetLine?.steps[state.playedSteps.length]
  const continuations = getContinuations(state.currentFen)
  if (designated) {
    const match = continuations.find((m) => m.uci === designated.uci)
    if (match) return match
  }
  return continuations[0]
}

/**
 * Attempts one of the drilling color's own moves at the current position. The
 * caller is responsible for legality (illegal moves should never reach here -
 * see the Phase 3 plan's "Wrong-move feedback" section). Any move that matches a
 * saved continuation AND still leads to at least one not-yet-completed line is
 * accepted as correct, even if it's not the current target line's designated
 * move - see the module doc on `retarget`. A saved move whose only reachable
 * lines have already been completed this session is rejected instead (see
 * `DrillFeedback`'s `alreadyDrilled` case) - never applied, and never counted
 * as a mistake, so the user is steered toward the still-pending branch without
 * being penalized for exploring the one they've already finished.
 */
export function attemptOwnMove(
  state: DrillSessionState,
  getContinuations: (fen: string) => RepertoireMove[],
  played: { uci: string; san: string; resultingFen: string },
): DrillSessionState {
  if (isSessionComplete(state)) return state

  const saved = getContinuations(state.currentFen).find((m) => m.uci === played.uci)
  if (saved) {
    const step: DrillStep = {
      fen: state.currentFen,
      san: played.san,
      uci: played.uci,
      resultingFen: saved.resultingFen,
      mover: 'own',
    }
    const playedSteps = [...state.playedSteps, step]

    if (pendingMatchId(state, playedSteps) === null) {
      return {
        ...state,
        lastAppliedSteps: [],
        lastFeedback: { kind: 'alreadyDrilled', playedSan: played.san, playedUci: played.uci },
      }
    }

    const currentTargetId = retarget(state, playedSteps)
    return advance({ ...state, currentTargetId }, playedSteps, [step])
  }

  const attemptNumber = state.wrongAttempts + 1
  const attemptToken = state.nextAttemptToken
  const hintMove = hintMoveFor(state, getContinuations)
  const feedback: DrillFeedback = {
    kind: 'wrong',
    attemptToken,
    attemptNumber,
    playedSan: played.san,
    playedUci: played.uci,
    originFen: state.currentFen,
    resultingFen: played.resultingFen,
    hintFrom: attemptNumber >= 2 ? hintMove?.uci.slice(0, 2) : undefined,
    hintTo: attemptNumber >= 3 ? hintMove?.uci.slice(2, 4) : undefined,
  }
  return {
    ...state,
    // A wrong move is never applied to the board, so nothing was played.
    lastAppliedSteps: [],
    wrongAttempts: attemptNumber,
    hasWrongAttemptThisOccurrence: true,
    lastFeedback: feedback,
    nextAttemptToken: attemptToken + 1,
  }
}

/**
 * Synchronously previews whether `uci` would be accepted at the current
 * position, without mutating any state - see the module doc on `attemptOwnMove`.
 * Intended for the UI layer to decide, before the async board-drop handling
 * settles, whether a piece drop should be allowed to "stick" (accepted) or
 * snap back (wrong, or a saved-but-already-drilled rejection).
 */
export function wouldAcceptOwnMove(
  state: DrillSessionState,
  getContinuations: (fen: string) => RepertoireMove[],
  uci: string,
): boolean {
  if (isSessionComplete(state)) return false
  const saved = getContinuations(state.currentFen).find((m) => m.uci === uci)
  if (!saved) return false
  const step: DrillStep = { fen: state.currentFen, san: '', uci, resultingFen: saved.resultingFen, mover: 'own' }
  return pendingMatchId(state, [...state.playedSteps, step]) !== null
}

/**
 * Merges an async engine classification into `lastFeedback`, but only if it's
 * still the feedback for the attempt that triggered it (the user may have
 * already retried, or moved on, by the time the engine responds).
 */
export function applyMoveClassification(
  state: DrillSessionState,
  attemptToken: number,
  classification: { cpLoss: number; isBad: boolean; bestResponseLine: EngineEvaluation },
): DrillSessionState {
  if (state.lastFeedback?.kind !== 'wrong' || state.lastFeedback.attemptToken !== attemptToken) return state
  return { ...state, lastFeedback: { ...state.lastFeedback, ...classification } }
}

/**
 * Requeues only the failed lines from the just-finished session as a fresh set
 * of pending drills, with a clean results slate for this new retry pass (see
 * the Phase 3 plan's Mistake tracking section: results are session-scoped).
 */
export function retryFailedLines(state: DrillSessionState): DrillSessionState {
  const failedIds = state.order.filter((id) => state.results[id] === 'failed')
  return beginNextOccurrence({ ...state, pendingIds: new Set(failedIds), results: {} })
}

/** Reorders upcoming (not yet attempted) presentation order - see the Phase 3 plan's "Shuffle order" control. */
export function reorderUpcoming(state: DrillSessionState, order: string[]): DrillSessionState {
  return { ...state, order }
}

export type DrillSessionProgress = {
  totalLines: number
  pendingCount: number
  perfectCount: number
  failedCount: number
}

export function sessionProgress(state: DrillSessionState): DrillSessionProgress {
  const outcomes = Object.values(state.results)
  return {
    totalLines: state.lines.length,
    pendingCount: state.pendingIds.size,
    perfectCount: outcomes.filter((o) => o === 'perfect').length,
    failedCount: outcomes.filter((o) => o === 'failed').length,
  }
}
