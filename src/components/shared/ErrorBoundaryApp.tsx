/**
 * El borde de errores de toda la app (2026-10-31). Reemplaza al de Sentry, que
 * obligaba a cargar Sentry entero (≈60 % del archivo de arranque) antes de
 * dibujar la primera pantalla. Hace lo mismo: muestra el respaldo, avisa a
 * `onError` (el registro propio) y, si hay DSN, manda el error a Sentry
 * cargándolo en ese momento.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: (p: { error: unknown }) => ReactNode;
  onError?: (error: unknown) => void;
}

export default class ErrorBoundaryApp extends Component<Props, { error: unknown; conError: boolean }> {
  state = { error: null as unknown, conError: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, conError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error);
    // Directo de import.meta.env: importar env.ts lo separaba en un chunk más.
    if (!import.meta.env.VITE_SENTRY_DSN) return;
    void import("@/lib/sentry")
      .then(m => m.capturarExcepcion(error, info.componentStack ?? undefined))
      .catch(() => undefined);
  }

  render() {
    return this.state.conError ? this.props.fallback({ error: this.state.error }) : this.props.children;
  }
}
