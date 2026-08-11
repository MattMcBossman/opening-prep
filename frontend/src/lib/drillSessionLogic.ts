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
      /**
       * How many plies into the game `originFen` is (0 = White's 1st move, 1 =
       * Black's 1st move, ...). `originFen`/`resultingFen` are frequently
       * normalized FENs with no reliable move-number fields of their own (see
       * `normalizeFen`), so this is tracked explicitly instead - see
       * `formatMoveListFromPly`, used to number the best-response line correctly.
       */
      originPly: number
      /** Filled in once the (async) engine comparison resolves - see useDrillSession. */
      cpLoss?: number
      isBad?: boolean
      bestResponseLine?: EngineEvaluation
      /** Origin square of a saved move, shown starting at the 2nd wrong attempt. */
      hintFrom?: string
      /** Destination square of a saved move, shown starting at the 3rd+ wrong attempt. */
      hintTo?: string
    }

/**
 * Set once a line is completed (a leaf is reached), and cleared only by
 * `acknowledgeLineCompletion` - the session pauses here, showing the final
 * position, until the user explicitly moves on. See the Phase 3 plan addendum
 * on pausing after each completed drill.
 */
export type CompletionPause = {
  lineId: string
  leafFen: string
  /** How many plies into the game `leafFen` is - see `DrillFeedback.originPly`. */
  leafPly: number
}

export type DrillSessionState = {
  lines: DrillLine[]
  linesById: Map<string, DrillLine>
  /**
   * Presentation order of line ids. Randomized whenever a pass begins (see
   * `createDrillSession`/`retryFailedLines`) so drills aren't always practiced
   * in the same sequence; an explicit `order` can be passed to `createDrillSession`
   * to opt out (used by tests that need a deterministic sequence).
   */
  order: string[]
  pendingIds: Set<string>
  results: Record<string, DrillOutcome>
  rootFen: string
  /** How many lines are in the *current pass* - `lines.length` normally, or the
   * failed-line count when this is a retry pass (see `retryFailedLines`). Used
   * for the "Drill X of Y" / "Retrying failed drill X of Y" progress readout. */
  passTotal: number
  /** True once `retryFailedLines` has been used to start a retry-only pass. */
  isRetryPass: boolean
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
  completionPause: CompletionPause | null
}

export function isSessionComplete(state: DrillSessionState): boolean {
  return state.pendingIds.size === 0
}

export function currentTargetLine(state: DrillSessionState): DrillLine | null {
  return state.currentTargetId ? state.linesById.get(state.currentTargetId) ?? null : null
}

/** Fisher-Yates shuffle; returns a new array, leaving `items` untouched. */
function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function createDrillSession(lines: DrillLine[], rootFen: string, order?: string[]): DrillSessionState {
  const resolvedOrder = order ?? shuffled(lines.map((l) => l.id))
  const base: DrillSessionState = {
    lines,
    linesById: new Map(lines.map((l) => [l.id, l])),
    order: resolvedOrder,
    pendingIds: new Set(resolvedOrder),
    results: {},
    rootFen,
    passTotal: lines.length,
    isRetryPass: false,
    currentTargetId: null,
    currentFen: rootFen,
    playedSteps: [],
    lastAppliedSteps: [],
    wrongAttempts: 0,
    hasWrongAttemptThisOccurrence: false,
    lastFeedback: null,
    nextAttemptToken: 0,
    completionPause: null,
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
    completionPause: null,
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
 * Applies exactly one step - either the user's own move (from `attemptOwnMove`)
 * or the next auto-played opponent reply (from `advanceAutoPlay`) - and settles
 * into whichever state follows: awaiting the user's next move, awaiting an
 * auto-played opponent reply (left for the caller to apply separately via
 * `advanceAutoPlay`), or complete. Deliberately never walks through more than
 * one ply per call, unlike the single-call multi-ply version this replaced -
 * that let the board's position jump two plies at once when a line ended right
 * after an auto-played reply, which animated as an abrupt jump rather than a
 * smooth per-move slide. See useDrillSession for how the two steps of a single
 * user move (the move itself, then its auto-played reply) get spaced out in time.
 */
function applyStep(state: DrillSessionState, currentTargetId: string | null, step: DrillStep): DrillSessionState {
  const playedSteps = [...state.playedSteps, step]
  const base: DrillSessionState = {
    ...state,
    currentTargetId,
    playedSteps,
    lastAppliedSteps: [step],
    currentFen: step.resultingFen,
    wrongAttempts: 0,
    lastFeedback: { kind: 'correct' },
  }
  const targetLine = currentTargetId ? state.linesById.get(currentTargetId) : undefined
  if (!targetLine || playedSteps.length >= targetLine.steps.length) {
    // playedSteps.length is this occurrence's actual ply count reached so far -
    // always correct even after a redirect (see `retarget`), unlike relying on
    // `targetLine.steps.length` (the *originally targeted* line's length).
    return completeOccurrence(base, currentTargetId, step.resultingFen, playedSteps.length)
  }
  // Otherwise there's more to this line: either the next step is the user's own
  // move (nothing further to do right now - `currentFen` is already correctly
  // positioned there, since a step's `resultingFen` is always the next step's
  // origin `fen`), or it's an opponent reply that `advanceAutoPlay` applies as
  // its own separate step.
  return base
}

/**
 * The opponent reply queued to be auto-played next, if the current target line
 * calls for one at this point and the session isn't paused for review - see
 * `advanceAutoPlay`.
 */
export function pendingAutoPlayStep(state: DrillSessionState): DrillStep | null {
  if (state.completionPause) return null
  const targetLine = state.currentTargetId ? state.linesById.get(state.currentTargetId) : undefined
  const nextStep = targetLine?.steps[state.playedSteps.length]
  return nextStep && nextStep.mover === 'opponent' ? nextStep : null
}

/**
 * Applies the opponent reply from `pendingAutoPlayStep`, as its own single-ply
 * step (see `applyStep`) - a no-op if there's no pending reply right now.
 */
export function advanceAutoPlay(state: DrillSessionState): DrillSessionState {
  const pending = pendingAutoPlayStep(state)
  if (!pending) return state
  return applyStep(state, state.currentTargetId, pending)
}

/**
 * Records the outcome of the line that was just completed and pauses the
 * session there (see `CompletionPause`) rather than immediately starting the
 * next occurrence - the caller shows the final position (plus, in the UI
 * layer, the opponent's best untried response) until `acknowledgeLineCompletion`
 * is called.
 */
function completeOccurrence(
  state: DrillSessionState,
  targetId: string | null,
  leafFen: string,
  leafPly: number,
): DrillSessionState {
  if (!targetId) return beginNextOccurrence(state)
  const outcome: DrillOutcome = state.hasWrongAttemptThisOccurrence ? 'failed' : 'perfect'
  const pendingIds = new Set(state.pendingIds)
  pendingIds.delete(targetId)
  const results = { ...state.results, [targetId]: outcome }
  return {
    ...state,
    pendingIds,
    results,
    currentFen: leafFen,
    playedSteps: [],
    wrongAttempts: 0,
    hasWrongAttemptThisOccurrence: false,
    lastFeedback: { kind: 'correct' },
    completionPause: { lineId: targetId, leafFen, leafPly },
  }
}

/**
 * Moves on from a just-completed line's pause, starting the next occurrence (or
 * settling into the fully-complete state if none remain). A no-op if the
 * session isn't currently paused.
 */
export function acknowledgeLineCompletion(state: DrillSessionState): DrillSessionState {
  if (!state.completionPause) return state
  return beginNextOccurrence(state)
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
  // A line just completed and is paused for review, or an opponent reply is
  // queued but not yet applied (see advanceAutoPlay) - ignore further attempts
  // until the caller settles that first.
  if (state.completionPause || pendingAutoPlayStep(state)) return state
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
    return applyStep(state, currentTargetId, step)
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
    originPly: state.playedSteps.length,
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
  if (state.completionPause || pendingAutoPlayStep(state)) return false
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
 * `passTotal`/`isRetryPass` are updated too, so progress reporting reflects only
 * this retry pass (e.g. "Retrying failed drill 1 of 3"), not the original
 * session's full line count. `order` is reshuffled too, same as a fresh session.
 */
export function retryFailedLines(state: DrillSessionState): DrillSessionState {
  const failedIds = state.order.filter((id) => state.results[id] === 'failed')
  return beginNextOccurrence({
    ...state,
    order: shuffled(state.order),
    pendingIds: new Set(failedIds),
    results: {},
    passTotal: failedIds.length,
    isRetryPass: true,
  })
}

/** Changes the presentation order without resetting the current drill or any recorded results. */
export function reorderUpcoming(state: DrillSessionState, order: string[]): DrillSessionState {
  return { ...state, order }
}

export type DrillSessionProgress = {
  /** Number of lines in the current pass (see `passTotal`), not necessarily the whole repertoire. */
  totalLines: number
  pendingCount: number
  perfectCount: number
  failedCount: number
  /**
   * 1-based index of the drill currently being attempted, or - while paused on
   * `completionPause` - the one just finished, for a "Drill X of Y" /
   * "Retrying failed drill X of Y" readout.
   */
  currentDrillNumber: number
  isRetryPass: boolean
}

export function sessionProgress(state: DrillSessionState): DrillSessionProgress {
  const outcomes = Object.values(state.results)
  const completedCount = state.passTotal - state.pendingIds.size
  const currentDrillNumber = Math.min(state.passTotal, Math.max(0, completedCount + (state.completionPause ? 0 : 1)))
  return {
    totalLines: state.passTotal,
    pendingCount: state.pendingIds.size,
    perfectCount: outcomes.filter((o) => o === 'perfect').length,
    failedCount: outcomes.filter((o) => o === 'failed').length,
    currentDrillNumber,
    isRetryPass: state.isRetryPass,
  }
}
