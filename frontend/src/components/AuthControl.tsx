import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AuthUser } from '../lib/authApi'
import { ApiError } from '../lib/apiClient'

type Props = {
  user: AuthUser | null
  loading: boolean
  onGoogleLogin: () => void
  onLinkLichess: () => void
  onLinkChessCom: (username: string) => Promise<void>
  onUnlinkChessCom: () => Promise<void>
  onLogout: () => void
}

export function AuthControl({ user, loading, onGoogleLogin, onLinkLichess, onLinkChessCom, onUnlinkChessCom, onLogout }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [chessComEditing, setChessComEditing] = useState(false)
  const [chessComUsername, setChessComUsername] = useState(user?.chessComUsername ?? '')
  const [chessComBusy, setChessComBusy] = useState(false)
  const [chessComError, setChessComError] = useState<string | null>(null)

  useEffect(() => setChessComUsername(user?.chessComUsername ?? ''), [user?.chessComUsername])

  useEffect(() => {
    if (!open) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      // A touch scroll starts with pointerdown, before the browser can tell it
      // apart from a tap. Closing here collapsed the inline mobile account
      // section while leaving its containing settings menu open. Mobile has a
      // prominent X, so reserve outside-pointer dismissal for mouse/pen input.
      if (event.pointerType === 'touch') return
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const submitChessCom = async (event: FormEvent) => {
    event.preventDefault()
    setChessComBusy(true)
    setChessComError(null)
    try {
      await onLinkChessCom(chessComUsername.trim())
      setChessComEditing(false)
    } catch (reason) {
      const usernameErrors = reason instanceof ApiError ? reason.fieldErrors?.username : null
      setChessComError(Array.isArray(usernameErrors) && typeof usernameErrors[0] === 'string'
        ? usernameErrors[0]
        : reason instanceof Error ? reason.message : 'Could not connect that Chess.com username.')
    } finally {
      setChessComBusy(false)
    }
  }

  const disconnectChessCom = async () => {
    setChessComBusy(true)
    setChessComError(null)
    try {
      await onUnlinkChessCom()
      setChessComEditing(false)
    } catch (reason) {
      setChessComError(reason instanceof Error ? reason.message : 'Could not disconnect Chess.com.')
    } finally {
      setChessComBusy(false)
    }
  }

  if (loading) {
    return <span className="header-toggle auth-control-loading">Loading…</span>
  }

  return (
    <div ref={containerRef} className={`mainline-auth-control${open ? ' open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="header-toggle auth-control"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
      >
        {user ? user.username : 'Sign in'}
      </button>
      {open && (
        <div className="mainline-auth-popover">
          <button
            type="button"
            className="auth-popover-close"
            aria-label="Close account menu"
            onClick={() => {
              setOpen(false)
              triggerRef.current?.focus()
            }}
          >
            ×
          </button>
          {user ? (
            <>
              <strong>{user.email ?? user.username}</strong>
              <div className="auth-provider-row">
                <div className="auth-provider-heading">
                  <strong>Lichess</strong>
                  {!user.lichessUsername && <button type="button" onClick={() => onLinkLichess()}>Connect</button>}
                </div>
                {user.lichessUsername && <p className="auth-provider-identity">{user.lichessUsername}</p>}
              </div>
              <div className="auth-provider-row auth-provider-chess-com">
                <div className="auth-provider-heading">
                  <strong>Chess.com</strong>
                  {!chessComEditing && (
                    <button type="button" onClick={() => setChessComEditing(true)}>
                      {user.chessComUsername ? 'Manage' : 'Connect'}
                    </button>
                  )}
                </div>
                {!chessComEditing && user.chessComUsername && (
                  <p className="auth-provider-identity">{user.chessComUsername}</p>
                )}
                {chessComEditing && (
                  <form className="chess-com-editor" onSubmit={submitChessCom}>
                    <label htmlFor="account-chess-com-username">Public username</label>
                    <div className="chess-com-editor-input-row">
                      <input
                        id="account-chess-com-username"
                        value={chessComUsername}
                        onChange={(event) => setChessComUsername(event.target.value)}
                        required
                        maxLength={64}
                        autoComplete="off"
                      />
                      <button type="submit" className="chess-com-save" disabled={chessComBusy}>
                        {chessComBusy ? 'Checking…' : 'Save'}
                      </button>
                    </div>
                    <p>Public game data only; this does not verify account ownership.</p>
                    <div className="chess-com-editor-actions">
                      <button type="button" disabled={chessComBusy} onClick={() => setChessComEditing(false)}>Cancel</button>
                      {user.chessComUsername && (
                        <button type="button" className="chess-com-disconnect" disabled={chessComBusy} onClick={() => void disconnectChessCom()}>Disconnect</button>
                      )}
                    </div>
                  </form>
                )}
                {chessComError && <p className="panel-status error">{chessComError}</p>}
              </div>
              <button type="button" className="auth-control-signout" onClick={onLogout}>Sign out</button>
            </>
          ) : (
            <>
              <strong>Sign in to Mainline</strong>
              <button type="button" className="google-sign-in" onClick={() => onGoogleLogin()}>
                Continue with Google
              </button>
              <small>Lichess and Chess.com can be connected after signing in.</small>
            </>
          )}
        </div>
      )}
    </div>
  )
}
