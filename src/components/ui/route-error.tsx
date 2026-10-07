"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";

import { reportClientError } from "@/app/actions/report-error";

/**
 * Rota hata sınırı — TEK KANONİK GÖRÜNÜM (/app ve /admin segmentlerinin `error.tsx` dosyaları bunu çizer).
 *
 * - Modül adını söyler ("Müşteriler şu anda açılamadı"), ham hata metnini ASLA göstermez
 *   (sunucu hatalarında Next zaten yalnız `digest` verir; istemci hatası metni de gösterilmez).
 * - "Tekrar dene" = Next 16.3 `retry()` (segmenti yeniden getirip çizer; yoksa `reset()`),
 *   "Ana ekrana dön" = modülün ana sayfası / panel.
 * - Hata kimliği (`digest`) görünür: kullanıcı destek talebine yazabilir; sunucu loglarıyla eşleşir.
 * - Hata `reportClientError` ile kaydedilir (oturumdan kiracı; hız sınırlı).
 *
 * Kullanım (segment `error.tsx`):
 *   "use client";
 *   import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";
 *   export default function MusterilerError(props: RouteErrorBoundaryProps) {
 *     return <RouteError {...props} moduleName="Müşteriler" />;
 *   }
 */

export type RouteErrorBoundaryProps = {
  error: Error & { digest?: string };
  /** Next 16.3: segmenti yeniden getirip çizer (önerilen). */
  retry?: () => void;
  /** Next: yalnız hata durumunu temizler (yeniden getirmeden). */
  reset?: () => void;
};

export type RouteErrorProps = RouteErrorBoundaryProps & {
  /** Kullanıcının bulunduğu modül ("Müşteriler", "Yönetim paneli"). */
  moduleName: string;
  /** Başlığı tamamen değiştirmek için (varsayılan: "<modül> şu anda açılamadı"). */
  title?: string;
  /** Dönüş bağlantısı (varsayılan /app). */
  homeHref?: string;
  homeLabel?: string;
};

export function RouteError({
  error,
  retry,
  reset,
  moduleName,
  title,
  homeHref = "/app",
  homeLabel = "Ana ekrana dön",
}: RouteErrorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    console.error(`[route-error] ${moduleName}`, error);
    void reportClientError({
      message: error?.message || "Bilinmeyen hata",
      digest: error?.digest,
      stack: error?.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error, moduleName]);

  // Klavye ve ekran okuyucu kullanıcısı kurtarma ekranının başından başlar.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const again = retry ?? reset;

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-10">
      <section role="alert" aria-labelledby="route-error-title" className="w-full max-w-md text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-[var(--radius-card)] border border-danger-500/15 bg-danger-500/10">
          <AlertTriangle className="h-7 w-7 text-danger-500" aria-hidden="true" />
        </div>
        <h2
          id="route-error-title"
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 font-display text-lg font-bold text-ink-950 outline-none"
        >
          {title ?? `${moduleName} şu anda açılamadı`}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          Eksik ya da yanlış bilgi göstermemek için ekranı durdurduk. Verileriniz güvende. Tekrar deneyin;
          sorun sürerse aşağıdaki hata kimliğiyle destek ekibine yazın.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {again ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => again())}
              className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60 touch:min-h-11"
            >
              <RotateCcw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
              {pending ? "Yükleniyor…" : "Tekrar dene"}
            </button>
          ) : null}
          <Link
            href={homeHref}
            className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:border-brand-300 touch:min-h-11"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {homeLabel}
          </Link>
        </div>
        {error?.digest ? (
          <p className="mt-4 text-xs text-text-muted">
            Hata kimliği:{" "}
            <code className="select-all rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-950">
              {error.digest}
            </code>
          </p>
        ) : null}
      </section>
    </div>
  );
}
