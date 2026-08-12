import type { LichessMergePreview } from '../lib/authApi'

type Props = {
  preview: LichessMergePreview | null
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function AccountMergePrompt({ preview, busy, error, onConfirm, onCancel }: Props) {
  if (!preview) return null

  return (
    <section className="panel import-prompt account-merge-prompt" role="alertdialog" aria-labelledby="account-merge-title">
      <h2 id="account-merge-title">Merge your Mainline accounts?</h2>
      <p>
        Lichess account <strong>{preview.lichessUsername}</strong> is attached to another Mainline account:{' '}
        <strong>{preview.legacyAccountLabel}</strong>.
        Merging will move its saved data into the account you’re signed into now.
      </p>
      <ul>
        <li>{preview.modules} saved module{preview.modules === 1 ? '' : 's'}</li>
        <li>{preview.profiles} profile{preview.profiles === 1 ? '' : 's'}</li>
        <li>{preview.drillSessions} drill session{preview.drillSessions === 1 ? '' : 's'}</li>
        {preview.publishedOpenings > 0 && <li>{preview.publishedOpenings} published opening{preview.publishedOpenings === 1 ? '' : 's'}</li>}
      </ul>
      <p className="panel-status">
        Existing modules stay separate; duplicate module and profile names receive a “merged” suffix. The older account is removed after a successful merge.
      </p>
      {error && <p className="panel-status error">{error}</p>}
      <div className="board-controls">
        <button type="button" className="account-merge-confirm" onClick={onConfirm} disabled={busy}>{busy ? 'Merging…' : 'Merge accounts'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </section>
  )
}
