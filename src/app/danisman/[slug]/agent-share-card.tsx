"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, QrCode, Share2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

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
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => null);
  const url = origin ? `${origin}/danisman/${slug}` : "";

  async function onShare() {
    if (!url) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${name} — ${office}`, text: `${name} kartviziti`, url });
        return;
      } catch (error) {
        if ((error as DOMException | null)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission can be denied; the QR remains available.
    }
  }

  const qrSrc = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=2&format=png&data=${encodeURIComponent(url)}`
    : "";

  return (
    <Dialog open={qrOpen} onOpenChange={setQrOpen}>
      {compact ? (
        <DialogTrigger asChild>
          <button
            type="button"
            className="focus-ring press flex flex-1 flex-col items-center gap-1 rounded-[var(--radius-card)] px-1 py-2 text-xs font-bold text-text-muted transition hover:text-brand-600"
          >
            <Share2 className="h-4 w-4" />
            Paylaş
          </button>
        </DialogTrigger>
      ) : (
        <>
          <button
            type="button"
            onClick={onShare}
            className="focus-ring press inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/[0.12]"
          >
            {copied ? <Check className="h-4 w-4 text-mint-400" /> : <Share2 className="h-4 w-4" />}
            {copied ? "Kopyalandı" : "Profili paylaş"}
          </button>
          <DialogTrigger asChild>
            <button
              type="button"
              title="QR kodu göster"
              aria-label="QR kodu göster"
              className="focus-ring press inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/[0.12]"
            >
              <QrCode className="h-4 w-4" />
            </button>
          </DialogTrigger>
        </>
      )}

      <DialogContent size="sm" className="max-w-xs text-center">
        <DialogHeader
          title="Kartvizit QR kodu"
          description="Kartviziti okutun veya güvenli bağlantıyı paylaşın."
          icon={<QrCode />}
        />
        <DialogBody className="pt-5">
          <div className="rounded-[var(--radius-card)] border border-line bg-white p-3">
            {qrSrc ? (
              // The external service receives only this already-public profile URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt="Kartvizit QR kodu"
                width={240}
                height={240}
                className="mx-auto h-[240px] w-[240px]"
              />
            ) : (
              <div className="h-[240px] w-full animate-pulse rounded-[var(--radius-card)] bg-canvas" />
            )}
          </div>
          <code className="mt-3 block truncate rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
            {url}
          </code>
          <button
            type="button"
            onClick={onShare}
            disabled={!url}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-card)] bg-brand-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-brand-600/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {copied ? "Kopyalandı" : "Linki paylaş"}
          </button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
