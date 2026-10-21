import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Si une vue plante, l'îlot reste visible avec un message plutôt que de disparaître. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[compi] erreur d’interface :', error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div data-island className="absolute top-0 left-1/2 -translate-x-1/2">
        <button
          onClick={() => this.setState({ error: null })}
          className="flex h-9 items-center gap-2 rounded-b-[18px] bg-black px-4 text-[12px] text-led-red ring-1 ring-white/5"
          title={this.state.error.message}
        >
          Oups, un souci d’affichage — clique pour relancer
        </button>
      </div>
    )
  }
}
