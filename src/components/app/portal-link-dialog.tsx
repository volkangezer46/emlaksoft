"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Link2, MessageCircle, Share2 } from "lucide-react";
import { createCustomerPortalToken } from "@/app/actions/customer-portal";
import { createOwnerPortalToken } from "@/app/actions/owner-portal";
import { toWhatsAppLink } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Portal linki üretme diyaloğu — müşteri portalı (/musteri-portali/[token]) ve
 * malik portalı (/malik-portali/[token]) için tek bileşen.
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

const WA_CUSTOMER = (name: string, url: string) =>
  `Merhaba ${name}, size özel müşteri portalınız hazır. Taleplerinizi, randevularınızı ve size uygun portföyleri buradan takip edebilirsiniz: ${url}`;

const WA_OWNER = (name: string, label: string, url: string) =>
  `Merhaba ${name}, ${label} için mülk sahibi portalınız hazır. İlan durumunu, gelen teklifleri ve randevuları buradan izleyebilirsiniz: ${url}`;

function ResultPanel({
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
    <div className="rounded-[16px] border border-mint-500/30 bg-mint-500/5 p-5 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-[13px] bg-mint-500/15 text-mint-600">
        <Check className="h-5 w-5" />
      </span>
      <p className="mt-3 font-display text-base font-bold text-ink-950">Portal linki hazır</p>
      <p className="mt-1 text-xs text-text-muted">
        Link 90-180 gün geçerlidir. İstediğiniz an &quot;Paylaşılan portallar&quot; listesinden iptal edebilirsiniz.
      </p>
      <p className="numeric mt-3 select-all break-all rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
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
            className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-mint-500/40 bg-mint-500/10 px-3 text-xs font-semibold text-mint-700 hover:bg-mint-500/20"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp&apos;ta gönder
          </a>
        ) : null}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-hairline-strong bg-surface px-3 text-xs font-semibold text-ink-950 hover:bg-canvas"
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

/** Müşteri portalı linki — /app/musteriler satır aksiyonu. */
export function CustomerPortalLinkButton({
  customerId,
  customerName,
  phone,
}: {
  customerId: string;
  customerName: string;
  phone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    setError(null);
    startTransition(async () => {
      const res = await createCustomerPortalToken(customerId);
      if (res.error || !res.url) setError(res.error ?? "Link üretilemedi.");
      else setUrl(res.url);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUrl(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600"
          aria-label={`${customerName} için müşteri portalı linki üret`}
          title="Müşteri portalı linki"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader
          icon={<Link2 />}
          title="Müşteri portalı linki"
          description={`${customerName} kendi taleplerini, randevularını ve eşleşen portföyleri bu linkten görür.`}
        />
        <DialogBody>
          {url ? (
            <ResultPanel
              url={url}
              waHref={toWhatsAppLink(phone, WA_CUSTOMER(customerName, url))}
              onReset={() => setOpen(false)}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-text-muted">
                Müşteri portalda önerilen portföyleri <strong className="text-ink-950">beğenir ya da
                eler</strong>; bu geri bildirim eşleştirme ekranındaki skoru besler (beğenilen +10 puan
                ve 💚 rozeti alır, elenen listeden gizlenir).
              </p>
              <p className="text-xs text-text-faint">
                Aynı müşteri için geçerli bir link zaten varsa yenisi üretilmez — mevcut link döner.
              </p>
              {error ? <p className="text-sm font-semibold text-danger-500">{error}</p> : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Kapat</Button>
          </DialogClose>
          {url ? null : (
            <Button type="button" onClick={generate} loading={pending}>
              Linki üret
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Malik portalı linki — /app/portfoyler kart aksiyonu. */
export function OwnerPortalLinkButton({
  propertyId,
  propertyLabel,
}: {
  propertyId: string;
  propertyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [pending, startTransition] = useTransition();

  const generate = () => {
    setError(null);
    if (!ownerName.trim()) {
      setError("Malik adı zorunludur.");
      return;
    }
    startTransition(async () => {
      const res = await createOwnerPortalToken(propertyId, ownerName, ownerPhone || undefined);
      if (res.error || !res.url) setError(res.error ?? "Link üretilemedi.");
      else setUrl(res.url);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUrl(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line bg-surface/90 text-text-muted shadow-[var(--shadow-xs)] backdrop-blur transition hover:border-brand-300 hover:text-brand-600"
          aria-label={`${propertyLabel} için malik portalı linki üret`}
          title="Malik portalı linki"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader
          icon={<Link2 />}
          title="Malik portalı linki"
          description={`${propertyLabel} — mülk sahibi ilan durumunu, teklifleri ve randevuları bu linkten izler.`}
        />
        <DialogBody>
          {url ? (
            <ResultPanel
              url={url}
              waHref={toWhatsAppLink(ownerPhone, WA_OWNER(ownerName, propertyLabel, url))}
              onReset={() => setOpen(false)}
            />
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-semibold text-text-muted">
                  Malik adı <span className="text-danger-500">*</span>
                </span>
                <input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  maxLength={120}
                  placeholder="Örn. Ahmet Yılmaz"
                  className="mt-1 w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-text-muted">
                  Telefon <span className="font-medium text-text-faint">(WhatsApp ile göndermek için)</span>
                </span>
                <input
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  inputMode="tel"
                  maxLength={20}
                  placeholder="05XX XXX XX XX"
                  className="mt-1 w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
                />
              </label>
              <p className="text-xs text-text-faint">
                Bu portföy için geçerli bir link zaten varsa yenisi üretilmez — mevcut link döner.
              </p>
              {error ? <p className="text-sm font-semibold text-danger-500">{error}</p> : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Kapat</Button>
          </DialogClose>
          {url ? null : (
            <Button type="button" onClick={generate} loading={pending}>
              Linki üret
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
