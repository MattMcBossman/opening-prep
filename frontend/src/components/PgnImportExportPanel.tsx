import { useCallback, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { findResponseConflicts } from '../lib/repertoireTree'
import { downloadRepertoirePgn } from '../lib/pgnExport'
import { parsePgnLinesWithMetadata } from '../lib/pgnImport'
import type { ParsedPgnEdge, ParsedPgnLine } from '../lib/pgnImport'
import type { PgnExportLine } from '../lib/pgnExport'
import type { RepertoireColor, RepertoireTree } from '../types'

type Props = {
  color: RepertoireColor
  getTree: (color: RepertoireColor) => RepertoireTree
  getEditingTree: (color: RepertoireColor) => RepertoireTree
  getLines: (color: RepertoireColor) => PgnExportLine[]
  isMoveSaved: (color: RepertoireColor, fen: string, uci: string) => boolean
  addLine: (color: RepertoireColor, steps: ParsedPgnEdge[], source?: 'manual' | 'pgn_import', label?: string, annotations?: ParsedPgnLine['annotations'], conflictPolicy?: 'reject' | 'replace') => void
  createModuleFromLines: (name: string, lines: ParsedPgnLine[]) => Promise<unknown>
}

type Preview = {
  edges: ParsedPgnEdge[]
  lines: ParsedPgnLine[]
  newCount: number
  savedCount: number
  conflictCount: number
  internalConflictCount: number
}

/**
 * Export/import the active color's repertoire as PGN (with RAV variations for
 * every saved branch point - see pgnExport.ts/pgnImport.ts). Import previews response conflicts before writing. Users may skip conflicting lines, explicitly replace the selected module's response, or create a separate module; a PGN that contains internal repertoire-side alternatives must be split before becoming one module.
 */
export function PgnImportExportPanel({ color, getTree, getEditingTree, getLines, isMoveSaved, addLine, createModuleFromLines }: Props) {
  const [importOpen, setImportOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null)
  const [moduleName, setModuleName] = useState('Imported opening')

  const handleExport = useCallback(() => {
    downloadRepertoirePgn(`${color}-repertoire`, getTree(color), color, getLines(color))
  }, [getTree, getLines, color])

  const openImport = useCallback(() => {
    setImportOpen(true)
    setPreview(null)
    setError(null)
    setConfirmedCount(null)
  }, [])

  const closeImport = useCallback(() => {
    setImportOpen(false)
    setDraft('')
    setPreview(null)
    setError(null)
  }, [])

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setDraft(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
    // Allow choosing the same file again after clearing it.
    e.target.value = ''
  }, [])

  const handlePreview = useCallback(() => {
    setConfirmedCount(null)
    const lines = parsePgnLinesWithMetadata(draft)
    const edges = lines.flatMap((line) => line.steps)
    if (edges.length === 0) {
      setPreview(null)
      setError('No moves found in that PGN.')
      return
    }
    const savedCount = edges.filter((edge) => isMoveSaved(color, edge.originFen, edge.uci)).length
    setError(null)
    const conflictCount = findResponseConflicts(getEditingTree(color), color, edges).length
    const internalConflictCount = findResponseConflicts({}, color, edges).length
    setPreview({ edges, lines, newCount: edges.length - savedCount, savedCount, conflictCount, internalConflictCount })
  }, [draft, color, isMoveSaved, getEditingTree])

  const handleConfirm = useCallback((policy: 'skip' | 'replace') => {
    if (!preview) return
    const current = getEditingTree(color)
    const lines = policy === 'skip'
      ? preview.lines.filter((line) => findResponseConflicts(current, color, line.steps).length === 0)
      : preview.lines
    for (const line of lines) addLine(color, line.steps, 'pgn_import', line.label, line.annotations, policy === 'replace' ? 'replace' : 'reject')
    setConfirmedCount(lines.flatMap((line) => line.steps).length)
    setPreview(null)
    setDraft('')
  }, [preview, color, addLine, getEditingTree])

  const colorLabel = useMemo(() => (color === 'white' ? 'White' : 'Black'), [color])

  return (
    <div className="pgn-panel">
      <div className="pgn-panel-actions">
        <button type="button" onClick={handleExport}>
          Export {colorLabel} PGN
        </button>
        {!importOpen && (
          <button type="button" onClick={openImport}>
            Import PGN
          </button>
        )}
      </div>
      {importOpen && (
        <div className="pgn-import">
          <div className="pgn-import-row">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setPreview(null)
                setError(null)
                setConfirmedCount(null)
              }}
              placeholder="Paste PGN here, or choose a file below"
              rows={4}
            />
          </div>
          <div className="pgn-import-row">
            <input type="file" accept=".pgn,.txt" onChange={handleFileChange} />
          </div>
          {error && <p className="panel-status error">{error}</p>}
          {preview && <>
            <p className="panel-status">{preview.newCount} new move{preview.newCount === 1 ? '' : 's'} ({preview.savedCount} already saved) into the {colorLabel} repertoire.</p>
            {preview.conflictCount > 0 && <p className="panel-status error">{preview.conflictCount} response conflict{preview.conflictCount === 1 ? '' : 's'} with the selected module.</p>}
            {preview.internalConflictCount > 0 && <p className="panel-status error">This PGN itself contains multiple repertoire responses at a position. Conflicting lines can only be skipped; split them into separate PGNs to create separate modules.</p>}
          </>}
          {confirmedCount !== null && (
            <p className="panel-status">
              Imported {confirmedCount} new move{confirmedCount === 1 ? '' : 's'}.
            </p>
          )}
          <div className="board-controls">
            {preview ? (<>
              <button type="button" onClick={() => handleConfirm('skip')}>{preview.conflictCount > 0 ? 'Import non-conflicting lines' : 'Confirm import'}</button>
              {preview.conflictCount > 0 && preview.internalConflictCount === 0 && <button type="button" onClick={() => handleConfirm('replace')}>Replace selected-module responses</button>}
              {preview.internalConflictCount === 0 && <><input aria-label="New module name" value={moduleName} maxLength={100} onChange={(event) => setModuleName(event.target.value)} /><button type="button" disabled={moduleName.trim() === ''} onClick={() => void createModuleFromLines(moduleName.trim(), preview.lines).then(() => { setConfirmedCount(preview.edges.length); setPreview(null); setDraft('') })}>Create separate module</button></>}
            </>) : (
              <button type="button" onClick={handlePreview} disabled={draft.trim() === ''}>
                Preview
              </button>
            )}
            <button type="button" onClick={closeImport}>
              {preview ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
