import { useState, type FormEvent } from 'react'
import { ApiError } from '../lib/apiClient'

type Props = {
  username: string | null
  onLink: (username: string) => Promise<void>
  onUnlink: () => Promise<void>
}

export function ChessComAccountControl({ username, onLink, onUnlink }: Props) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(username ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLink(value.trim())
      setOpen(false)
    } catch (reason) {
      const usernameErrors = reason instanceof ApiError ? reason.fieldErrors?.username : null
      setError(Array.isArray(usernameErrors) && typeof usernameErrors[0] === 'string'
        ? usernameErrors[0]
        : reason instanceof Error ? reason.message : 'Could not connect that Chess.com username.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await onUnlink()
      setValue('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disconnect Chess.com.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="chess-com-account-control">
    <button type="button" className="header-toggle auth-control" onClick={() => setOpen((shown) => !shown)} aria-expanded={open}>
      {username ? `Chess.com: ${username}` : 'Connect Chess.com'}
    </button>
    {open && <div className="chess-com-account-popover">
      <strong>Chess.com games</strong>
      <p>Connect a public username. Chess.com does not provide Mainline an OAuth sign-in, so this does not verify account ownership.</p>
      <form onSubmit={submit}>
        <label htmlFor="chess-com-username">Chess.com username</label>
        <input id="chess-com-username" value={value} onChange={(event) => setValue(event.target.value)} required maxLength={64} autoComplete="off" />
        <button type="submit" disabled={busy}>{busy ? 'Checking…' : username ? 'Update' : 'Connect'}</button>
      </form>
      {username && <button type="button" className="chess-com-disconnect" disabled={busy} onClick={disconnect}>Disconnect</button>}
      {error && <p className="panel-status error">{error}</p>}
    </div>}
  </div>
}
