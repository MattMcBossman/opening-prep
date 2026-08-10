export type ClientCacheMetric =
  | 'explorerHit'
  | 'explorerMiss'
  | 'engineMemoryHit'
  | 'engineServerHit'
  | 'engineMiss'
  | 'engineAnalysisStarted'
  | 'engineAnalysisCompleted'
  | 'engineAnalysisCancelled'

const counters: Record<ClientCacheMetric, number> = {
  explorerHit: 0,
  explorerMiss: 0,
  engineMemoryHit: 0,
  engineServerHit: 0,
  engineMiss: 0,
  engineAnalysisStarted: 0,
  engineAnalysisCompleted: 0,
  engineAnalysisCancelled: 0,
}

export function recordClientCacheMetric(metric: ClientCacheMetric): void {
  counters[metric] += 1
}

/** Snapshot used by browser diagnostics and future telemetry integration. */
export function getClientCacheMetrics(): Readonly<Record<ClientCacheMetric, number>> {
  return { ...counters }
}
