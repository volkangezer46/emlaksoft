"use client";

import { useState, useTransition } from "react";
import { Check, Link2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { createSurveyForDeal } from "@/app/actions/surveys";

/** Anket linkini panoya kopyalar — 2 sn "Kopyalandı" (presentation-actions deseni). */
export function CopySurveyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const { push } = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Pano izni yoksa bağlantı bildirimde gösterilir (eski Safari/kiosk).
          push(`Pano erişimi yok; bağlantıyı elle kopyalayın: ${url}`, "info");
        }
      }}
      title="Anket linkini kopyala"
      icon={copied ? Check : Link2}
    >
      {copied ? "Kopyalandı" : "Linki kopyala"}
    </Button>
  );
}

/**
 * Kapanan anlaşmadan tek tıkla anket üretir; başarıda link kopyalama
 * butonuna dönüşür (SMS yok — İYS kapsam dışı, linki danışman iletir).
 * Mükerrer üretimi DB'deki unique(deal_id) keser; action dostane mesaj döner.
 */
export function CreateSurveyButton({ dealId }: { dealId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (url) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs font-semibold text-[color:var(--viz-pos)]">Anket hazır</span>
        <CopySurveyLinkButton url={url} />
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="primary"
        size="sm"
        loading={pending}
        icon={Send}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set("deal_id", dealId);
          startTransition(async () => {
            const res = await createSurveyForDeal(fd);
            if (res.error) {
              setError(res.error);
              return;
            }
            setUrl(res.url ?? null);
          });
        }}
      >
        Anket oluştur
      </Button>
      {error ? (
        <span className="text-xs font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
