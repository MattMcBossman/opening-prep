import { useCallback, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { exportRepertoireToPgn } from '../lib/pgnExport'
import { parsePgnLinesWithMetadata } from '../lib/pgnImport'
import type { ParsedPgnEdge, ParsedPgnLine } from '../lib/pgnImport'
import type { PgnExportLine } from '../lib/pgnExport'
import type { RepertoireColor, RepertoireTree } from '../types'

type Props = {
  color: RepertoireColor
  getTree: (color: RepertoireColor) => RepertoireTree
  getLines: (color: RepertoireColor) => PgnExportLine[]
  isMoveSaved: (color: RepertoireColor, fen: string, uci: string) => boolean
  addLine: (color: RepertoireColor, steps: ParsedPgnEdge[], source?: 'manual' | 'pgn_import', label?: string, annotations?: ParsedPgnLine['annotations']) => void
}

type Preview = {
  edges: ParsedPgnEdge[]
  lines: ParsedPgnLine[]
  newCount: number
  savedCount: number
}

/** Triggers a browser download of `text` as a file named `filename`, with no server round trip. */
function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-chess-pgn' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Export/import the active color's repertoire as PGN (with RAV variations for
 * every saved branch point - see pgnExport.ts/pgnImport.ts). Import is
 * additive/idempotent: it only ever adds edges via `addMove`, so it's always
 * safe to import into a non-empty repertoire, and re-importing the same PGN
 * twice changes nothing the second time.
 */
export function PgnImportExportPanel({ color, getTree, getLines, isMoveSaved, addLine }: Props) {
  const [importOpen, setImportOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null)

  const handleExport = useCallback(() => {
    const pgn = exportRepertoireToPgn(getTree(color), color, getLines(color))
    downloadTextFile(`${color}-repertoire.pgn`, pgn)
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
    setPreview({ edges, lines, newCount: edges.length - savedCount, savedCount })
  }, [draft, color, isMoveSaved])

  const handleConfirm = useCallback(() => {
    if (!preview) return
    for (const line of preview.lines) addLine(color, line.steps, 'pgn_import', line.label, line.annotations)
    setConfirmedCount(preview.newCount)
    setPreview(null)
    setDraft('')
  }, [preview, color, addLine])

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
          {preview && (
            <p className="panel-status">
              {preview.newCount} new move{preview.newCount === 1 ? '' : 's'} ({preview.savedCount} already saved)
              into the {colorLabel} repertoire.
            </p>
          )}
          {confirmedCount !== null && (
            <p className="panel-status">
              Imported {confirmedCount} new move{confirmedCount === 1 ? '' : 's'}.
            </p>
          )}
          <div className="board-controls">
            {preview ? (
              <button type="button" onClick={handleConfirm}>
                Confirm import
              </button>
            ) : (
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
