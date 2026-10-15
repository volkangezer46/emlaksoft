"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { reportClientError } from "@/app/actions/report-error";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error?: Error;
};

/**
 * Next'in çerçeve "hataları" gerçek hata değildir, yönlendirme sinyalidir: `notFound()` / `forbidden()` /
 * `unauthorized()` → digest `NEXT_HTTP_ERROR_FALLBACK;<kod>`, `redirect()` → digest `NEXT_REDIRECT;…`. Sunucu bileşeninden
 * gelince istemcide React #441 (digest taşıyan) hatası olarak görünür. Bunları yakalayan özel sınır Next'in kendi
 * not-found / yönlendirme sınırlarını devre dışı bırakır (silinmiş kayıtta menüsüz "Bir şeyler ters gitti" çıkıyordu, B072).
 */
export function isNextFrameworkError(error: unknown): boolean {
  const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest.startsWith("NEXT_REDIRECT"));
}

/**
 * Kabuk hata sınırı (/app layout): yalnız GERÇEK hataları yakalar. Çerçeve sinyalleri (notFound / redirect) yeniden
 * fırlatılır; böylece kabuk içindeki `app/app/not-found.tsx` ve Next yönlendirmesi çalışır (Next'in kendi ErrorBoundary'si
 * de `getDerivedStateFromError` içinde aynısını yapar). Sayfa hataları zaten `app/app/error.tsx`'te (kabuk ayakta) kalır.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    if (isNextFrameworkError(error)) throw error;
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    if (isNextFrameworkError(error)) return;
    console.error("ErrorBoundary caught:", error, errorInfo);
    // Hata kaydına da yaz (aynı hata tekrarlanırsa sayaç artar); başarısızlık akışı bozmaz.
    try {
      void reportClientError({
        message: error.message || "Bilinmeyen hata",
        stack: error.stack,
        path: typeof window !== "undefined" ? window.location.pathname : undefined,
      }).catch(() => {});
    } catch {
      /* yut */
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-[var(--radius-card)] bg-danger-500/10">
              <AlertTriangle className="h-8 w-8 text-danger-500" />
            </div>
            <h1 className="mt-4 font-display text-2xl font-extrabold text-ink-950">
              Bir şeyler ters gitti
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Beklenmeyen bir hata oluştu. Lütfen sayfayı yenileyin.
            </p>
            {process.env.NODE_ENV === "development" && this.state.error ? (
              <pre className="mt-4 rounded-[var(--radius-card)] border border-danger-300 bg-danger-50 p-3 text-left text-xs text-danger-700">
                {this.state.error.message}
                {"\n"}
                {this.state.error.stack?.slice(0, 300)}
              </pre>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-[var(--radius-control)] bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
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
