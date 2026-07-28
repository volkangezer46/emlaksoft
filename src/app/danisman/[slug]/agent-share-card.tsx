"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, QrCode, Share2, X } from "lucide-react";

/**
 * "Profili paylaş" — native paylaşım / panoya kopyala + QR kodu.
 *
 * NEDEN CLIENT: navigator.share, pano API'si ve QR açılır penceresi tarayıcı
 * gerektirir. Adres client'ta `window.location.origin` ile kurulur — sayfa ISR
 * ile CDN'den servis edildiği için sunucuda mutlak adres varsaymak yanlış olur
 * (booking-link-form / calendar-subscribe-card deseni).
 *
 * QR görseli harici servisle (goqr.me) üretilir — bkz. components/public/vitrin-qr.tsx
 * gerekçesi: depoda doğrulanabilir bir QR encoder yok, hatalı QR sessiz felakettir.
 * Servise yalnızca zaten herkese açık kartvizit adresi gider.
 */
function subscribeNoop() {
  return () => {};
}

export function AgentShareCard({
  name,
  office,
  slug,
  compact = false,
}: {
  name: string;
  office: string;
  slug: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => null,
  );
  const url = origin ? `${origin}/danisman/${slug}` : "";

  async function onShare() {
    if (!url) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${name} — ${office}`, text: `${name} kartviziti`, url });
        return;
      } catch (e) {
        if ((e as DOMException | null)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* pano izni yoksa sessiz kal — QR yine kullanılabilir */
    }
  }

  const qrSrc = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=2&format=png&data=${encodeURIComponent(url)}`
    : "";

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className="focus-ring press flex flex-1 flex-col items-center gap-1 rounded-[12px] px-1 py-2 text-[10px] font-bold text-text-muted transition hover:text-brand-600"
        >
          <Share2 className="h-4 w-4" />
          Paylaş
        </button>
        {qrOpen ? <QrOverlay url={url} qrSrc={qrSrc} onShare={onShare} copied={copied} onClose={() => setQrOpen(false)} /> : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onShare}
        className="focus-ring press inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/[0.12]"
      >
        {copied ? <Check className="h-4 w-4 text-mint-400" /> : <Share2 className="h-4 w-4" />}
        {copied ? "Kopyalandı" : "Profili paylaş"}
      </button>
      <button
        type="button"
        onClick={() => setQrOpen(true)}
        title="QR kodu göster"
        aria-label="QR kodu göster"
        className="focus-ring press inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/[0.12]"
      >
        <QrCode className="h-4 w-4" />
      </button>
      {qrOpen ? <QrOverlay url={url} qrSrc={qrSrc} onShare={onShare} copied={copied} onClose={() => setQrOpen(false)} /> : null}
    </>
  );
}

function QrOverlay({
  url,
  qrSrc,
  copied,
  onShare,
  onClose,
}: {
  url: string;
  qrSrc: string;
  copied: boolean;
  onShare: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Kartvizit QR kodu"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-[22px] border border-line bg-surface p-5 text-center shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-display text-sm font-extrabold text-ink-950">Kartvizit QR kodu</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="focus-ring rounded-full p-1 text-text-faint transition hover:text-ink-950"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 rounded-[16px] border border-line bg-white p-3">
          {qrSrc ? (
            /* Harici servis görseli — next/image yerine img (uzak domain ayarı gerekmez) */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={qrSrc} alt="Kartvizit QR kodu" width={240} height={240} className="mx-auto h-[240px] w-[240px]" />
          ) : (
            <div className="h-[240px] w-full animate-pulse rounded-[12px] bg-canvas" />
          )}
        </div>
        <code className="mt-3 block truncate rounded-[10px] border border-line bg-canvas px-3 py-2 text-[11px] text-ink-950">
          {url}
        </code>
        <button
          type="button"
          onClick={onShare}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] bg-brand-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-brand-600/90"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          {copied ? "Kopyalandı" : "Linki paylaş"}
        </button>
      </div>
    </div>
  );
}
