"use client";

import { useState, useTransition } from "react";
import { ExternalLink, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { expenseClaimReceiptUrl } from "@/app/actions/expense-claim";

/** Fişi kısa ömürlü (5 dk) imzalı bağlantıyla açar: görsel sayfada önizlenir, PDF yeni sekmede açılır. */
export function ReceiptPreview({ claimId, isPdf }: { claimId: string; isPdf: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function open() {
    setError(null);
    start(async () => {
      const r = await expenseClaimReceiptUrl(claimId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (isPdf) window.open(r.url, "_blank", "noopener,noreferrer");
      else setUrl(r.url);
    });
  }

  return (
    <div className="grid gap-3">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- imzalı özel kova bağlantısı; next/image optimizasyonu dışında
        <img src={url} alt="Masraf fişi" className="max-h-[70vh] w-full rounded-[var(--radius-control)] border border-line object-contain" />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" icon={isPdf ? ExternalLink : ReceiptText} loading={pending} onClick={open}>
          {url ? "Fişi yenile" : isPdf ? "Fişi (PDF) aç" : "Fişi göster"}
        </Button>
        {error ? <p role="alert" className="text-sm text-danger-600">{error}</p> : null}
      </div>
    </div>
  );
}
