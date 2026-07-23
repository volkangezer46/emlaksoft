"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error?: Error;
};

/**
 * Global error boundary
 * Catch React errors ve kullanıcıya güzel hata göster
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-[16px] bg-danger-500/10">
              <AlertTriangle className="h-8 w-8 text-danger-500" />
            </div>
            <h1 className="mt-4 font-display text-2xl font-extrabold text-ink-950">
              Bir şeyler ters gitti
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Beklenmeyen bir hata oluştu. Lütfen sayfayı yenileyin.
            </p>
            {process.env.NODE_ENV === "development" && this.state.error ? (
              <pre className="mt-4 rounded-[12px] border border-danger-300 bg-danger-50 p-3 text-left text-xs text-danger-700">
                {this.state.error.message}
                {"\n"}
                {this.state.error.stack?.slice(0, 300)}
              </pre>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-[11px] bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Sayfayı yenile
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
