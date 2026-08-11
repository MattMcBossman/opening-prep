import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

const ERROR_STORAGE_KEY = 'opening-prep:last-render-error'

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Mainline render failed', error, info)
    try {
      sessionStorage.setItem(ERROR_STORAGE_KEY, JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        recordedAt: new Date().toISOString(),
      }))
    } catch {
      // The visible fallback still reports the error when storage is blocked.
    }
  }

  private recoverWithBlackRepertoire = () => {
    try {
      localStorage.setItem('opening-prep:board-color', 'black')
      sessionStorage.removeItem('opening-prep:view-session:v1')
    } finally {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="app-crash-fallback" role="alert">
        <h1>Mainline hit an error</h1>
        <p>The page stopped while rendering. Your repertoire data has not been changed.</p>
        <pre>{this.state.error.name}: {this.state.error.message}</pre>
        <div className="board-controls">
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" onClick={this.recoverWithBlackRepertoire}>Recover with Black repertoire</button>
        </div>
      </main>
    )
  }
}
