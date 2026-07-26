"use client";

import { useState, useTransition } from "react";
import { Check, Link2, Loader2, Send } from "lucide-react";
import { createSurveyForDeal } from "@/app/actions/surveys";

/** Anket linkini panoya kopyalar — 2 sn "Kopyalandı" (presentation-actions deseni). */
export function CopySurveyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Pano izni yoksa prompt en garantili yedek (eski Safari/kiosk).
          window.prompt("Linki kopyalayın:", url);
        }
      }}
      title="Anket linkini kopyala"
      className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-hairline-strong bg-surface px-2.5 text-xs font-semibold text-ink-950 transition hover:bg-canvas"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? "Kopyalandı" : "Linki kopyala"}
    </button>
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
        <span className="text-[11px] font-semibold text-mint-600">Anket hazır</span>
        <CopySurveyLinkButton url={url} />
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
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
        className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Anket oluştur
      </button>
      {error ? (
        <span className="text-[11px] font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
