"use client";

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
      <button
        type="button"
        onClick={() => selectAll(true)}
        className="focus-ring press rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:text-ink-950"
      >
        Sayfadakileri seç ({pageCount})
      </button>
      <button
        type="button"
        onClick={() => selectAll(false)}
        className="focus-ring press rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:text-ink-950"
      >
        Seçimi temizle
      </button>
      {confirmCount === null ? (
        <button
          type="button"
          onClick={ask}
          disabled={pending}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
          Seçilenleri çözüldü yap
        </button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-800">
          {confirmCount} hata çözüldü olarak işaretlensin mi?
          <button type="button" onClick={run} className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-2.5 py-1 text-white">
            Evet, işaretle
          </button>
          <button type="button" onClick={() => setConfirmCount(null)} className="focus-ring press rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1 text-ink-950">
            Vazgeç
          </button>
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
      <button
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
        className="focus-ring press inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-amber-400/50 hover:text-amber-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Yeniden aç
      </button>
      {error ? <span role="alert" className="text-xs font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}
