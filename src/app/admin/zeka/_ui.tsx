"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PlugZap, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Outcome = { ok?: boolean; error?: string; detail?: string };

/**
 * Yapay zeka merkezi formu: sunucu eylemini çağırır, sonucu satır içinde gösterir (doğrulama hatası kaybolmaz) ve
 * başarıda sayfayı tazeler. Yetkisiz personelde alanlar kilitli (salt okunur görünüm).
 */
export function ZekaActionForm({
  action,
  children,
  submitLabel = "Kaydet",
  readOnly,
  resetOnSuccess,
  className,
}: {
  action: (formData: FormData) => Promise<Outcome>;
  children: ReactNode;
  submitLabel?: string;
  readOnly?: boolean;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<Outcome | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className={className}
      action={(fd) =>
        start(async () => {
          const r = await action(fd);
          setState(r);
          if (r.ok) {
            if (resetOnSuccess) ref.current?.reset();
            router.refresh();
          }
        })
      }
    >
      <fieldset disabled={readOnly || pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        {children}
      </fieldset>
      {readOnly ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {submitLabel}
          </Button>
          <p role="status" aria-live="polite" className={`m-0 text-sm ${state?.error ? "text-danger-700" : "text-success-700"}`}>
            {state?.error ? state.error : state?.ok ? (state.detail ?? "Kaydedildi.") : ""}
          </p>
        </div>
      )}
    </form>
  );
}

type TestResult = { ok: boolean; latencyMs: number | null; model: string; message: string };

/** "Bağlantıyı test et": tek küçük, ölçülen çağrı; içerik gösterilmez, yalnız sonuç ve süre. */
export function ZekaTestButton({ action, disabled }: { action: () => Promise<TestResult>; disabled?: boolean }) {
  const [res, setRes] = useState<TestResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <Button type="button" size="sm" variant="secondary" disabled={disabled || pending} onClick={() => start(async () => setRes(await action()))}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
        Bağlantıyı test et
      </Button>
      <div role="status" aria-live="polite">
        {res ? (
          <p className={`m-0 flex flex-wrap items-center gap-2 text-sm ${res.ok ? "text-success-700" : "text-danger-700"}`}>
            {res.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
            <span className="font-semibold">{res.ok ? "Başarılı" : "Başarısız"}</span>
            <span>{res.message}</span>
            <span className="text-text-muted">
              {res.model ? `Model: ${res.model}` : ""}
              {res.latencyMs != null ? ` · ${res.latencyMs.toLocaleString("tr-TR")} ms` : ""}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** "Yeniden oluştur": bilgi tabanını tazeler ve anlamsal dizin işini hemen çalıştırır. */
export function ZekaRebuildButton({ action, disabled }: { action: () => Promise<Outcome>; disabled?: boolean }) {
  const [res, setRes] = useState<Outcome | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const r = await action();
            setRes(r);
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        Yeniden oluştur
      </Button>
      <p role="status" aria-live="polite" className={`m-0 text-sm ${res?.error ? "text-danger-700" : "text-success-700"}`}>
        {res?.error ?? (res?.ok ? res.detail : "")}
      </p>
    </div>
  );
}
