"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { summarizeCallNotes } from "@/app/actions/calls";

/**
 * Çağrı geçmişi satırında "AI özet" butonu — notu olan çağrılar için.
 * Sunucu tarafında OpenAI anahtarı doğrulanmadan bu bileşen hiç render
 * edilmez (bkz. page.tsx `isAiConfigured`). Sonuç kaydedilmez; satır
 * altında anlık gösterilir.
 */
export function CallAiSummary({ callId }: { callId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ summary: string; nextStep: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await summarizeCallNotes(callId);
      if (res.error || !res.summary || !res.nextStep) {
        setError(res.error ?? "AI özeti şu an üretilemedi.");
        return;
      }
      setResult({ summary: res.summary, nextStep: res.nextStep });
    });
  }

  return (
    <div className="relative z-10 md:col-span-4">
      {!result ? (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 transition hover:border-brand-300 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {pending ? "Özetleniyor…" : "AI özet"}
        </button>
      ) : null}
      {error ? <p className="mt-1.5 text-[11px] font-medium text-danger-500">{error}</p> : null}
      {result ? (
        <div className="rounded-[12px] border border-brand-600/15 bg-brand-600/[0.04] px-3.5 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-600">
            <Sparkles className="h-3 w-3" /> AI özet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-950">{result.summary}</p>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-mint-600">
            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" /> {result.nextStep}
          </p>
        </div>
      ) : null}
    </div>
  );
}
