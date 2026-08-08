import type { AuthUser } from '../lib/authApi'

type Props = {
  user: AuthUser | null
  loading: boolean
  onLogin: () => void
  onLogout: () => void
}

/**
 * Signed-out/signed-in switch for the header, alongside ThemeToggle/SoundToggle.
 * Unlike those toggles this isn't a `role="switch"` - signing in is a full
 * browser navigation away and back (see useAuth), not an in-place state flip.
 */
export function AuthControl({ user, loading, onLogin, onLogout }: Props) {
  if (loading) {
    return <span className="header-toggle auth-control-loading">Loading…</span>
  }

  if (!user) {
    return (
      <button type="button" className="header-toggle auth-control" onClick={onLogin}>
        Sign in with Lichess
      </button>
    )
  }

  return (
    <span className="header-toggle auth-control auth-control-signed-in">
      <span className="header-toggle-label">{user.username}</span>
      <button type="button" className="auth-control-signout" onClick={onLogout}>
        Sign out
      </button>
    </span>
  )
}
