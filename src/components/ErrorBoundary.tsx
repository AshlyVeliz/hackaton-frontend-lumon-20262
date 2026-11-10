import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main role="alert" className="min-h-screen grid place-items-center bg-slate-950 text-slate-100">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Algo salió mal</h1>
          <p className="mt-2 text-slate-400">{this.state.error.message}</p>
          <button
            className="mt-4 rounded bg-sky-600 px-4 py-2"
            onClick={() => {
              this.setState({ error: null })
              window.location.assign('/files')
            }}
          >
            Volver al inicio
          </button>
        </div>
      </main>
    )
  }
}
