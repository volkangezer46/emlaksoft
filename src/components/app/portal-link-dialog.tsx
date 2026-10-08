"use client";

import { useState } from "react";
import Link from "@/components/ui/smart-link";
import { Check, Copy, ExternalLink, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Portal link yardımcıları. Müşteri portalı sayfa içi panel:
 * `app/musteriler/customer-portal-panel.tsx` (ResultPanel ve WA_CUSTOMER buradan paylaşılır).
 * Malik portalı da sayfa içi panel: `app/portfoyler/[id]/owner-portal-panel.tsx`.
 *
 * Bu ekran olmadan `createCustomerPortalToken` / `createOwnerPortalToken`
 * server action'larının repoda HİÇBİR çağıranı yoktu: public portal sayfaları
 * ve token'lı aksiyonlar hazırdı ama danışman link üretemiyordu. Zincirleme
 * etki: `portal_match_feedback` yalnız müşteri portalından dolduğu için
 * eşleştirmedeki "💚 müşteri beğendi / beğenilmeyeni gizle" öğrenme döngüsü
 * hiç tetiklenmemişti.
 *
 * Link üretimi idempotent: action aktif token varsa onu döndürür, yoksa yenisini
 * açar. Üretilen link kopyalanır ve (telefon varsa) WhatsApp'tan gönderilir.
 */

export const WA_CUSTOMER = (name: string, url: string) =>
  `Merhaba ${name}, size özel müşteri portalınız hazır. Taleplerinizi, randevularınızı ve size uygun portföyleri buradan takip edebilirsiniz: ${url}`;

export function ResultPanel({
  url,
  waHref,
  onReset,
}: {
  url: string;
  waHref: string | null;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Panoya kopyalanamadı — linki elle seçip kopyalayın.");
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/5 p-5 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-mint-500/15 text-mint-600">
        <Check className="h-5 w-5" />
      </span>
      <p className="mt-3 font-display text-base font-bold text-ink-950">Portal linki hazır</p>
      <p className="mt-1 text-xs text-text-muted">
        Link 90-180 gün geçerlidir. İstediğiniz an &quot;Paylaşılan portallar&quot; listesinden iptal edebilirsiniz.
      </p>
      <p className="numeric mt-3 select-all break-all rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
        {url}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="sm" onClick={copy} type="button">
          {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Kopyalandı" : "Linki kopyala"}
        </Button>
        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-mint-500/40 bg-mint-500/10 px-3 text-xs font-semibold text-mint-700 hover:bg-mint-500/20"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp&apos;ta gönder
          </a>
        ) : null}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline-strong bg-surface px-3 text-xs font-semibold text-ink-950 hover:bg-canvas"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Önizle
        </a>
      </div>
      {copyError ? <p className="mt-3 text-xs font-semibold text-danger-500">{copyError}</p> : null}
      <Link
        href="/app/portfoyler/sunumlar#paylasilan-portallar"
        className="mt-4 inline-block text-xs font-semibold text-brand-600 hover:underline"
        onClick={onReset}
      >
        Paylaşılan portallar listesi →
      </Link>
    </div>
  );
}
/**
 * Malik portalı linki: portföy kart / satır eylemi. Popup YOK; portföy detayındaki
 * "Portallar" sekmesinde sayfa içi panel açılır (oluştur, kopyala, süre uzat, iptal).
 */
export function OwnerPortalLinkButton({
  propertyId,
  propertyLabel,
}: {
  propertyId: string;
  propertyLabel: string;
}) {
  return (
    <Link
      href={`/app/portfoyler/${propertyId}?sekme=portallar#malik-portali`}
      className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted shadow-[var(--shadow-xs)] transition hover:border-brand-300 hover:text-brand-600"
      aria-label={`${propertyLabel} için malik portalı linki`}
      title="Malik portalı linki"
    >
      <Share2 className="h-4 w-4" />
    </Link>
  );
}
