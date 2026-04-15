"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Fallback UI personalizado. Si no se pasa, se usa el fallback por defecto. */
  fallback?: ReactNode;
  /** Callback llamado cuando se captura un error (úsalo para mostrar toast). */
  onError?: (error: Error, info: { componentStack: string }) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary de clase para envolver screens críticos.
 * Los hooks (useToast) no pueden usarse aquí directamente — pasa onError
 * como prop desde el componente padre funcional para integrar toast.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    this.props.onError?.(error, { componentStack: info.componentStack ?? "" });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const error = this.state.error;

    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12 text-center"
        style={{ background: "var(--aa-cream)", color: "var(--aa-text)" }}
      >
        <div
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ background: "rgba(232,131,74,0.12)", border: "1.5px solid rgba(232,131,74,0.3)" }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-6 w-6"
            style={{ color: "var(--aa-orange)" }}
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 8a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <h2 className="mb-2 text-lg font-bold" style={{ color: "var(--aa-green-dark)" }}>
          Algo salió mal en esta sección
        </h2>
        <p className="mb-6 max-w-xs text-sm leading-relaxed" style={{ color: "var(--aa-text-muted)" }}>
          {error?.message || "Error inesperado. Puedes intentarlo de nuevo."}
        </p>

        <button
          type="button"
          onClick={this.handleReset}
          className="rounded-full px-5 py-2 text-sm font-bold text-white transition"
          style={{ background: "var(--aa-orange)" }}
        >
          Intentar de nuevo
        </button>
      </div>
    );
  }
}
