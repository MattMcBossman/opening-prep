import { useEffect, useMemo, useState } from 'react'
import { generateOpeningCandidate, type OpeningGenerationProgress, type OpeningGenerationResult } from '../lib/openingGeneratorApi'
import { generatedLineSegments } from '../lib/generatedLineLabel'
import type { RepertoireColor } from '../types'
import type { LeafScoreParameters } from '../lib/repertoireCoverage'

type Props = {
  color: RepertoireColor
  prefixUci: string[]
  openingName?: string | null
  lichessToken?: string
  existingLines: string[][]
  canFillGaps: boolean
  scoreParameters: LeafScoreParameters
  onScoreParametersChange: (parameters: LeafScoreParameters) => void
  onAddLines: (name: string, pgn: string) => Promise<number>
  onFillLines: (pgn: string) => Promise<number>
  onExploreLine: (pathUci: string[]) => void
}

function DisplayedLine({ pathUci, basePly }: { pathUci: string[], basePly: number }) {
  const line = generatedLineSegments(pathUci, basePly)
  return <span className="opening-generator-line-moves">
    {line.starting && <span className="starting">{line.starting}</span>}
    {line.added && <span className="added">{line.added}</span>}
  </span>
}

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function OpeningGeneratorPanel({ color, prefixUci, openingName, lichessToken, existingLines, canFillGaps, scoreParameters, onScoreParametersChange, onAddLines, onFillLines, onExploreLine }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(openingName ?? '')
  const [maxLines, setMaxLines] = useState(50)
  const [maxPly, setMaxPly] = useState(Math.max(22, prefixUci.length + 4))
  const [requestedCoverage, setRequestedCoverage] = useState(95)
  const [mode, setMode] = useState<'new_tree' | 'fill_gaps'>('new_tree')
  const [generating, setGenerating] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addedCount, setAddedCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OpeningGenerationResult | null>(null)
  const [progress, setProgress] = useState<OpeningGenerationProgress | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const slug = useMemo(() => (name || 'opening').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), [name])
  const summary = result?.report.summary
  const limitedPositionCount = summary
    ? summary.leafBudgetLimited + summary.replyLimitReached + summary.frequencyThresholdLimited
    : 0

  useEffect(() => {
    if (!open) return
    setName(openingName ?? '')
    setMaxPly((value) => Math.max(value, prefixUci.length + 4))
    setResult(null)
    setAddedCount(null)
    setError(null)
  }, [open, openingName, prefixUci])

  const submit = async () => {
    setGenerating(true)
    setError(null)
    setResult(null)
    setAddedCount(null)
    setProgress({ phase: 'starting', message: 'Sending the recommendation request…', current: null, total: null, retryAtMs: null, suggestions: [], activeLineUci: [], activeBasePly: 0 })
    setElapsedSeconds(0)
    try {
      setResult(await generateOpeningCandidate({
        name: name.trim(), color, prefix: prefixUci, coverage: requestedCoverage / 100,
        maxLines, maxPly, minGames: 20, minFrequency: 0.01,
        maxOpponentReplies: 8, useEngine: true, engineDepth: 16,
        maxEngineLossCp: 35, engineCandidates: 5,
        mode, existingLines: mode === 'fill_gaps' ? existingLines : [], moveBudget: maxLines,
        requestedCoverage: requestedCoverage / 100,
        minimumScore: scoreParameters.minimumScore,
        evaluationWeight: scoreParameters.evaluationWeight,
        minimumEvaluation: scoreParameters.minimumEvaluation,
        ...(lichessToken ? { lichessToken } : {}),
      }, undefined, setProgress))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Generation failed.')
    } finally {
      setGenerating(false)
      setProgress(null)
    }
  }

  useEffect(() => {
    if (!generating) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [generating])

  const addToModule = async () => {
    if (!result) return
    setAdding(true)
    setError(null)
    try {
      setAddedCount(await (mode === 'fill_gaps' ? onFillLines(result.pgn) : onAddLines(result.name, result.pgn)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the generated lines.')
    } finally {
      setAdding(false)
    }
  }

  const submitDisabled = generating || prefixUci.length === 0 || (mode === 'new_tree' && name.trim() === '') || maxPly <= prefixUci.length

  return <section className={`panel opening-generator-panel ${open ? 'open' : ''}`} data-guide="opening-generator">
    <div className="opening-generator-heading"><div><div className="opening-generator-title"><h2>Recommended tree</h2><span className="development-tag">In development</span></div><p>{open ? 'Choose a goal, then tune only what matters.' : 'Generate a new module or target the biggest gaps in this one.'}</p></div><button type="button" className="opening-generator-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? 'Close' : 'Recommend moves'}</button></div>
    {open && <div className="opening-generator-form">
      <div className="opening-generator-mode" role="group" aria-label="Recommendation goal">
        <button type="button" className={mode === 'new_tree' ? 'active' : ''} aria-pressed={mode === 'new_tree'} onClick={() => setMode('new_tree')}><strong>New module</strong><span>Build from this position</span></button>
        <button type="button" className={mode === 'fill_gaps' ? 'active' : ''} aria-pressed={mode === 'fill_gaps'} disabled={!canFillGaps} onClick={() => setMode('fill_gaps')}><strong>Fill coverage gaps</strong><span>Improve the selected module</span></button>
      </div>
      {!canFillGaps && <p className="opening-generator-note">Select a personal module to enable gap filling.</p>}
      {prefixUci.length === 0 && <p className="panel-status error">Play or load an opening line before generating.</p>}

      <fieldset className="opening-generator-section">
        <legend>{mode === 'fill_gaps' ? 'Coverage goal' : 'Module goal'}</legend>
        {mode === 'new_tree' ? <>
          <label>Module name<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fried Liver Attack" /></label>
          <div className="opening-generator-grid compact">
            <label>Requested coverage<div className="input-suffix"><input type="number" min={1} max={100} value={requestedCoverage} onChange={(event) => setRequestedCoverage(Number(event.target.value))} /><span>%</span></div><small>Target prepared reply mass per gap</small></label>
            <label>Move budget<input type="number" min={1} max={250} value={maxLines} onChange={(event) => setMaxLines(Number(event.target.value))} /><small>Maximum new saved moves</small></label>
          </div>
        </> : <div className="opening-generator-grid compact">
          <label>Requested coverage<div className="input-suffix"><input type="number" min={1} max={100} value={requestedCoverage} onChange={(event) => setRequestedCoverage(Number(event.target.value))} /><span>%</span></div><small>Target prepared reply mass per gap</small></label>
          <label>Move budget<input type="number" min={1} max={250} value={maxLines} onChange={(event) => setMaxLines(Number(event.target.value))} /><small>Maximum new saved moves</small></label>
        </div>}
      </fieldset>

      <details className="opening-generator-advanced">
        <summary>Advanced settings</summary>
        <div className="opening-generator-grid">
          <label>Maximum ply<input type="number" min={prefixUci.length + 1} max={80} value={maxPly} onChange={(event) => setMaxPly(Number(event.target.value))} /><small>Stop extending after this game ply</small></label>
          <label>Minimum score<input type="number" step="1" value={scoreParameters.minimumScore} onChange={(event) => onScoreParametersChange({ ...scoreParameters, minimumScore: Number(event.target.value) })} /><small>Shared with coverage analysis</small></label>
            <label>Evaluation weight<input type="number" step="0.5" value={scoreParameters.evaluationWeight} onChange={(event) => onScoreParametersChange({ ...scoreParameters, evaluationWeight: Number(event.target.value) })} /></label>
            <label>Evaluation floor<input type="number" step="0.1" value={scoreParameters.minimumEvaluation} onChange={(event) => onScoreParametersChange({ ...scoreParameters, minimumEvaluation: Number(event.target.value) })} /></label>
        </div>
        <p className="opening-generator-note"><strong>Stockfish quality check</strong><br />Applied automatically when the server engine is available, including beyond sampled Lichess positions.</p>
      </details>

      <div className="opening-generator-submit"><p>After {prefixUci.length} plies · {color} repertoire</p><button type="button" className="primary-action" disabled={submitDisabled} onClick={() => void submit()}>{generating ? 'Working…' : mode === 'fill_gaps' ? 'Find coverage gaps' : 'Generate module'}</button></div>
      {generating && progress && <div className="opening-generator-progress" role="status" aria-live="polite">
        <div className="opening-generator-progress-header"><span className="opening-generator-spinner" aria-hidden="true" /><strong>{progress.retryAtMs && progress.retryAtMs > Date.now()
          ? `Lichess asked Mainline to pause. Resuming in ${Math.ceil((progress.retryAtMs - Date.now()) / 1000)}s…`
          : progress.message}</strong><span>{elapsedSeconds}s</span></div>
        {progress.total !== null && progress.total > 0 && <><progress value={progress.current ?? 0} max={progress.total} /><small>{progress.current ?? 0} of {progress.total} candidates checked · {progress.suggestions.length} lines currently suggested</small></>}
        {progress.total === null && <small>Results will appear here when the review is ready.</small>}
        {progress.activeLineUci.length > 0 && <button type="button" className="opening-generator-active-line" onClick={() => onExploreLine(progress.activeLineUci)}>
          <span>Examining now</span><strong><DisplayedLine pathUci={progress.activeLineUci} basePly={progress.activeBasePly} /></strong><small>View current position in Explorer</small>
        </button>}
        {progress.suggestions.length > 0 && <div className="opening-generator-live-lines" aria-label="Suggested lines available so far">
          {progress.suggestions.map((suggestion, index) => <button type="button" key={suggestion.id} onClick={() => onExploreLine(suggestion.pathUci)}><span>Line {index + 1}</span><strong><DisplayedLine pathUci={suggestion.pathUci} basePly={suggestion.basePly} /></strong><small>View in Explorer</small></button>)}
        </div>}
      </div>}
      {error && <p className="panel-status error" role="alert">{error}</p>}
      {result && <div className="opening-generator-result">
        <div className="opening-generator-result-heading"><span>Recommendation ready</span><strong>{result.leafCount} {mode === 'fill_gaps' ? 'coverage gaps' : 'leaf lines'}</strong></div>
        <p>{mode === 'fill_gaps' ? 'Review these recommendations before adding them to the selected module.' : `Review the quality checks before creating a new personal ${color} module.`}</p>
        {mode === 'fill_gaps' && result.proposals && <div className="opening-generator-summary" aria-label="Gap recommendation summary">
          <span><strong>{result.proposals.reduce((total, proposal) => total + proposal.newMoveCount, 0)}</strong> new moves</span>
          <span><strong>{result.proposals.filter((proposal) => proposal.exactTransposition).length}</strong> exact transpositions</span>
          <span><strong>{result.proposals.filter((proposal) => proposal.similarityDistance !== null && proposal.similarityDistance <= 6).length}</strong> familiar positions</span>
        </div>}
        {summary && <div className="opening-generator-summary" aria-label="Generated tree quality summary">
          <span><strong>{summary.coverageTargetMet} of {summary.opponentPositions}</strong> opponent positions met the coverage target</span>
          <span><strong>{summary.minimumOpponentCoverage === null ? 'No data' : `${(summary.minimumOpponentCoverage * 100).toFixed(1)}%`}</strong> minimum sampled coverage</span>
          <span><strong>{summary.maximumGeneratedPly}</strong> deepest generated ply</span>
          <span><strong>{result.report.engine ? 'Stockfish balanced' : 'Elite practical model'}</strong> repertoire move selection</span>
        </div>}
        {summary && limitedPositionCount > 0 && <p className="panel-status opening-generator-warning">
          {limitedPositionCount} opponent position{limitedPositionCount === 1 ? ' was' : 's were'} below target because of the leaf budget, reply limit, or frequency threshold. Inspect the report before importing.
        </p>}
        {summary && summary.noEligibleMoves > 0 && <p className="panel-status opening-generator-warning">
          {summary.noEligibleMoves} opponent position{summary.noEligibleMoves === 1 ? ' had' : 's had'} no reply above the configured sample thresholds.
        </p>}
        {!result.report.engine && <p className="panel-status opening-generator-warning">Without engine filtering, Mainline chooses your moves by Lichess popularity rather than objective soundness.</p>}
        {result.proposals && result.proposals.length > 0 && <div className="opening-generator-live-lines" aria-label="Recommended lines">
          {result.proposals.map((proposal, index) => <button type="button" key={proposal.id} onClick={() => onExploreLine(proposal.pathUci)}><span>Line {index + 1}</span><strong><DisplayedLine pathUci={proposal.pathUci} basePly={proposal.basePly} /></strong><small>View in Explorer</small></button>)}
        </div>}
        <div className="opening-generator-result-actions"><button type="button" className="primary-action" disabled={adding || addedCount !== null || result.leafCount === 0} onClick={() => void addToModule()}>{addedCount !== null ? `Added ${addedCount} lines` : adding ? 'Adding…' : mode === 'fill_gaps' ? 'Add to module draft' : 'Create module'}</button><div><button type="button" onClick={() => download(`${slug}.pgn`, result.pgn, 'application/x-chess-pgn')}>PGN</button><button type="button" onClick={() => download(`${slug}.report.json`, `${JSON.stringify(result.report, null, 2)}\n`, 'application/json')}>Report</button></div></div>
        <details className="opening-generator-preview"><summary>Preview generated PGN</summary><pre>{result.pgn}</pre></details>
      </div>}
    </div>}
  </section>
}
