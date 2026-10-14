"use client";

import { Button } from "@/components/ui/button";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2, RotateCcw } from "lucide-react";
import { reopenErrorLog, resolveErrorLogs } from "@/app/actions/error-logs";
import { ERRORS_BULK_FORM_ID } from "./bulk-form-id";

/**
 * Toplu "çözüldü" çubuğu: seçimi DOM'daki `form=` bağlı kutulardan okur (satırlar sunucu bileşeni).
 * Onay satır içidir (popup yok): önce "N hata çözüldü olarak işaretlensin mi?" sorulur.
 */
export function ErrorsBulkBar({ pageCount }: { pageCount: number }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function boxes(): HTMLInputElement[] {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${ERRORS_BULK_FORM_ID}"]`),
    );
  }

  function selectAll(checked: boolean) {
    for (const b of boxes()) b.checked = checked;
    setConfirmCount(null);
  }

  function ask() {
    const n = boxes().filter((b) => b.checked).length;
    if (n === 0) {
      setMessage({ tone: "error", text: "Önce çözülecek hataları seçin." });
      return;
    }
    setMessage(null);
    setConfirmCount(n);
  }

  function run() {
    const ids = boxes().filter((b) => b.checked).map((b) => b.value);
    setConfirmCount(null);
    start(async () => {
      const res = await resolveErrorLogs(ids);
      if (res.error) setMessage({ tone: "error", text: res.error });
      else {
        setMessage({ tone: "ok", text: `${res.count ?? 0} hata çözüldü olarak işaretlendi.` });
        router.refresh();
      }
    });
  }

  return (
    <form
      id={ERRORS_BULK_FORM_ID}
      ref={formRef}
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5"
    >
      <Button variant="outline" size="sm" type="button" onClick={() => selectAll(true)}>
        Sayfadakileri seç ({pageCount})
      </Button>
      <Button variant="outline" size="sm" type="button" onClick={() => selectAll(false)}>
        Seçimi temizle
      </Button>
      {confirmCount === null ? (
        <Button variant="navy" size="sm" type="button" onClick={ask} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
          Seçilenleri çözüldü yap
        </Button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-800">
          {confirmCount} hata çözüldü olarak işaretlensin mi?
          <Button variant="navy" size="xs" type="button" onClick={run}>
            Evet, işaretle
          </Button>
          <Button variant="outline" size="xs" type="button" onClick={() => setConfirmCount(null)}>
            Vazgeç
          </Button>
        </span>
      )}
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-xs font-semibold ${message.tone === "error" ? "text-danger-600" : "text-mint-700"}`}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

/** Çözülmüş hatayı yeniden açık listesine alır. */
export function ReopenErrorButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="outline" size="sm"
 type="button"
 disabled={pending}
 onClick={() =>
 start(async () => {
 const res = await reopenErrorLog(id);
 if (res.error) setError(res.error);
 else {
 setError(null);
 router.refresh();
 }
 })
 }
 className="shrink-0">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Yeniden aç
      </Button>
      {error ? <span role="alert" className="text-xs font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}
