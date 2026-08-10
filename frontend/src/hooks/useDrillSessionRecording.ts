import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createDrillSession, finishDrillSession, submitDrillAttempts } from '../lib/drillsApi'
import type { CreateDrillSessionPayload, DrillAttemptPayload, DrillLineOutcome } from '../lib/drillsApi'

// Flush attempts periodically rather than holding them all until the session
// ends - both so a long session doesn't accumulate an unbounded buffer, and so
// data isn't lost entirely if the tab closes mid-session.
const BATCH_SIZE = 5
const FLUSH_INTERVAL_MS = 5000

export type DrillAttemptEvent = DrillAttemptPayload & {
  /** Local-only correlation id (not sent to the server) - see recordClassification. */
  attemptToken: number
}

export type DrillAttemptClassification = { attemptToken: number; cpLoss: number; isBad: boolean }

export type DrillSessionRecording = {
  onSessionStart: (isRetryPass: boolean) => void
  onAttempt: (event: DrillAttemptEvent) => void
  onAttemptClassified: (classification: DrillAttemptClassification) => void
  onSessionFinish: (results: DrillLineOutcome[]) => void
}

/**
 * Records a drill session for later analysis (see AGENTS.md's per-position
 * weakness tracking and the Phase 4 plan). This is intentionally best-effort:
 * every network call here is fire-and-forget with errors swallowed, since a
 * recording failure must never interrupt or alter the drill itself - the
 * in-session perfect/failed summary and "Retry failed" flow are computed
 * entirely client-side (see drillSessionLogic.ts) and don't depend on this.
 *
 * `enabled` should be `Boolean(user) && repertoireId !== null` - recording
 * needs both a signed-in user (attempts are tied to an account) and a known
 * server-side repertoire id to attach the session to.
 */
export function useDrillSessionRecording(
  enabled: boolean,
  repertoireIdOrConfig: number | CreateDrillSessionPayload | null,
): DrillSessionRecording {
  const sessionIdRef = useRef<number | null>(null)
  const sessionFailedRef = useRef(false)
  const bufferRef = useRef<Map<number, DrillAttemptPayload>>(new Map())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }, [])

  const flush = useCallback(() => {
    clearFlushTimer()
    if (bufferRef.current.size === 0) return

    const sessionId = sessionIdRef.current
    if (sessionId === null) {
      if (sessionFailedRef.current) {
        // Session creation never succeeded - give up on these attempts rather
        // than retrying forever (see the module doc: best-effort, not guaranteed).
        bufferRef.current.clear()
        return
      }
      // Session creation is still in flight - retry shortly rather than
      // dropping these attempts.
      flushTimerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS)
      return
    }

    const attempts = Array.from(bufferRef.current.values())
    bufferRef.current.clear()
    submitDrillAttempts(sessionId, attempts).catch(() => {
      // Best-effort - see the module doc.
    })
  }, [clearFlushTimer])

  const onSessionStart = useCallback(
    (isRetryPass: boolean) => {
      clearFlushTimer()
      bufferRef.current.clear()
      sessionIdRef.current = null
      sessionFailedRef.current = false
      if (!enabled || repertoireIdOrConfig === null) {
        sessionFailedRef.current = true
        return
      }
      const request = typeof repertoireIdOrConfig === 'number'
        ? repertoireIdOrConfig
        : { ...repertoireIdOrConfig, isRetryPass }
      createDrillSession(request, isRetryPass).then(
        (res) => {
          sessionIdRef.current = res.id
        },
        () => {
          sessionFailedRef.current = true
        },
      )
    },
    [enabled, repertoireIdOrConfig, clearFlushTimer],
  )

  const onAttempt = useCallback(
    (event: DrillAttemptEvent) => {
      if (!enabled) return
      const { attemptToken, ...payload } = event
      bufferRef.current.set(attemptToken, payload)
      if (bufferRef.current.size >= BATCH_SIZE) {
        flush()
      } else if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS)
      }
    },
    [enabled, flush],
  )

  const onAttemptClassified = useCallback(({ attemptToken, cpLoss, isBad }: DrillAttemptClassification) => {
    const pending = bufferRef.current.get(attemptToken)
    // If it's already flushed, the classification is simply dropped - a minor
    // loss of detail for a best-effort analytics feature, not a correctness bug.
    if (pending) bufferRef.current.set(attemptToken, { ...pending, cpLoss, isBad })
  }, [])

  const onSessionFinish = useCallback(
    (results: DrillLineOutcome[]) => {
      if (!enabled) return
      flush()
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId === null) return
      finishDrillSession(sessionId, results).catch(() => {
        // Best-effort - see the module doc.
      })
    },
    [enabled, flush],
  )

  useEffect(() => clearFlushTimer, [clearFlushTimer])

  // Stable identity unless one of the callbacks actually changes, so consumers
  // (useDrillSession) don't re-run effects keyed on this object every render.
  return useMemo(
    () => ({ onSessionStart, onAttempt, onAttemptClassified, onSessionFinish }),
    [onSessionStart, onAttempt, onAttemptClassified, onSessionFinish],
  )
}
