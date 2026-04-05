import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary catches render-time errors in its subtree and shows
 * a recoverable fallback UI instead of crashing the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  private readonly handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-4 p-8 text-center h-full min-h-40"
      >
        <AlertTriangle className="w-10 h-10 text-accent-red" />
        <p className="text-sm text-text-muted max-w-md">
          {this.props.fallbackMessage ?? "Something went wrong. Try again or reload the page."}
        </p>
        <button
          onClick={this.handleRetry}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-bg-secondary border border-border-subtle text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
}
