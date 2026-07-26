"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Handshake } from "lucide-react";
import { convertOfferToDeal } from "@/app/actions/offers";

/**
 * Kabul edilmiş teklifte "Anlaşma oluştur" CTA'sı.
 *
 * Server action aynı müşteri + portföy için açık anlaşma varsa ona bağlar,
 * yoksa negotiation aşamasında yeni anlaşma açar. Başarıda doğrudan anlaşma
 * detayına yönlendirilir; yönlendirme öncesi/yerine link de gösterilir.
 */
export function ConvertToDealButton({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ dealId: string; linked: boolean } | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await convertOfferToDeal(offerId);
      if (res.error || !res.dealId) {
        setError(res.error ?? "Anlaşma oluşturulamadı.");
        return;
      }
      setResult({ dealId: res.dealId, linked: Boolean(res.linked) });
      router.push(`/app/anlasmalar/${res.dealId}`);
    });
  }

  if (result) {
    return (
      <Link
        href={`/app/anlasmalar/${result.dealId}`}
        className="focus-ring press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        {result.linked ? "Bağlanan anlaşmayı aç" : "Anlaşmayı aç"}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="btn-shine focus-ring press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        <Handshake className="h-4 w-4" />
        {pending ? "Anlaşma hazırlanıyor…" : "Anlaşma oluştur"}
      </button>
      {error ? (
        <p className="text-xs font-semibold text-danger-600" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
