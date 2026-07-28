import React, { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends (React.Component as any) {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught Error in React Component Tree:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleResetState = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn("Could not clear storage:", e);
    }
    window.location.reload();
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020617] text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0f172a] border border-[#1e293b] rounded-2xl p-6 shadow-2xl text-center flex flex-col items-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Se detectó un inconveniente al cargar</h2>
              <p className="text-xs text-slate-400 mt-1">
                Ocurrió un error inesperado al renderizar el mapa o los datos.
              </p>
            </div>

            {this.state.error && (
              <div className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-left font-mono text-[11px] text-rose-300 overflow-x-auto max-h-32">
                {this.state.error.toString()}
              </div>
            )}

            <div className="flex flex-col w-full space-y-2 pt-2">
              <button
                onClick={this.handleReload}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs flex items-center justify-center space-x-2 transition"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recargar Aplicación</span>
              </button>

              <button
                onClick={this.handleResetState}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium rounded-xl text-xs flex items-center justify-center space-x-2 transition border border-slate-700"
              >
                <Trash2 className="w-4 h-4 text-slate-400" />
                <span>Restablecer Datos Locales y Recargar</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
