"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissDemoSeedRetry, retryRegistrationDemoSeed } from "@/app/actions/sample-retry";

/**
 * Kayıtta örnek veri yüklenemediyse Başlangıç kartı içinde gösterilen satır: tek tıkla yeniden dene ya da vazgeç.
 * Kanonik Button (dokunmatikte 44px) + semantik uyarı/hata token'ları (koyu tema uyumlu).
 */
export function OrnekVeriYenile() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      role="group"
      aria-label="Örnek veri yüklenemedi"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-warning-strong/30 bg-warning-soft px-4 py-3"
    >
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="text-sm font-bold text-warning-strong">Örnek veri yüklenemedi, buradan yeniden dene</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
          Kaydınız tamamlandı ancak seçtiğiniz örnek veriler yüklenemedi. Yeniden deneyebilir ya da boş ofisle devam edebilirsiniz.
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-xs font-semibold text-danger-strong">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={RefreshCw}
          loading={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await retryRegistrationDemoSeed();
              if (res.error) setError(res.error);
              router.refresh();
            })
          }
        >
          Yeniden dene
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await dismissDemoSeedRetry();
              router.refresh();
            })
          }
        >
          Gerek yok
        </Button>
      </div>
    </div>
  );
}
