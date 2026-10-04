"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Link2, MessageCircle, RefreshCw, XCircle } from "lucide-react";
import {
  createOwnerPortalToken,
  extendOwnerPortalToken,
  revokeOwnerPortalToken,
} from "@/app/actions/owner-portal";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { toWhatsAppLink } from "@/lib/phone";

export type OwnerPortalTokenRow = {
  id: string;
  url: string;
  ownerName: string;
  ownerPhone: string | null;
  expiresAt: string;
  lastSeenAt: string | null;
  /** Sunucuda hesaplanır (bileşende zaman okunmaz). */
  active: boolean;
  daysLeft: number | null;
};

const WA_OWNER = (name: string, label: string, url: string) =>
  `Merhaba ${name}, ${label} için mülk sahibi portalınız hazır. İlan durumunu, gelen teklifleri ve randevuları buradan izleyebilirsiniz: ${url}`;

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
}

/**
 * Malik portalı yönetimi — portföy detayı › Portallar sekmesi (sayfa içi panel, popup yok).
 * Oluştur, kopyala, WhatsApp ile gönder, süre uzat, iptal et.
 */
export function OwnerPortalPanel({
  propertyId,
  propertyLabel,
  tokens,
  canEdit,
}: {
  propertyId: string;
  propertyLabel: string;
  tokens: OwnerPortalTokenRow[];
  canEdit: boolean;
}) {
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!ownerName.trim()) {
      setError("Malik adı zorunludur.");
      return;
    }
    startTransition(async () => {
      const res = await createOwnerPortalToken(propertyId, ownerName, ownerPhone || undefined);
      if (res.error || !res.url) {
        setError(res.error ?? "Link üretilemedi.");
        return;
      }
      setNotice("Portal linki hazır.");
      setOwnerName("");
      setOwnerPhone("");
    });
  }

  function run(action: (fd: FormData) => Promise<{ error?: string; ok?: boolean }>, id: string, extra?: Record<string, string>) {
    setError(null);
    setNotice(null);
    const fd = new FormData();
    fd.set("id", id);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    startTransition(async () => {
      const res = await action(fd);
      if (res.error) setError(res.error);
    });
  }

  async function copy(row: OwnerPortalTokenRow) {
    try {
      await navigator.clipboard.writeText(row.url);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Panoya kopyalanamadı — linki elle seçip kopyalayın.");
    }
  }

  return (
    <section id="malik-portali" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Link2 className="h-4 w-4 text-brand-600" /> Malik portalı
        </h2>
        <p className="text-xs text-text-muted">
          Mülk sahibi ilan durumunu, teklifleri ve randevuları kendisine verdiğiniz linkten izler.
        </p>
      </div>

      {tokens.length > 0 ? (
        <ul className="divide-y divide-line">
          {tokens.map((t) => (
            <li key={t.id} className="space-y-2 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink-950">{t.ownerName}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    t.active ? "bg-mint-500/15 text-mint-700" : "bg-ink-950/6 text-text-muted"
                  }`}
                >
                  {t.active ? `Aktif · ${t.daysLeft ?? 0} gün kaldı` : "Süresi doldu / iptal"}
                </span>
                <span className="text-xs text-text-muted">
                  Bitiş {fmt(t.expiresAt)}
                  {t.lastSeenAt ? ` · son görülme ${fmt(t.lastSeenAt)}` : " · henüz açılmadı"}
                </span>
              </div>
              <p className="numeric select-all break-all rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
                {t.url}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => copy(t)}>
                  {copiedId === t.id ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedId === t.id ? "Kopyalandı" : "Kopyala"}
                </Button>
                {toWhatsAppLink(t.ownerPhone, WA_OWNER(t.ownerName, propertyLabel, t.url)) ? (
                  <a
                    href={toWhatsAppLink(t.ownerPhone, WA_OWNER(t.ownerName, propertyLabel, t.url)) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-mint-500/40 bg-mint-500/10 px-3 text-xs font-semibold text-mint-700 hover:bg-mint-500/20"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                ) : null}
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline-strong bg-surface px-3 text-xs font-semibold text-ink-950 hover:bg-canvas"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Önizle
                </a>
                {canEdit ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={pending}
                      onClick={() => run(extendOwnerPortalToken, t.id, { days: "90" })}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> {t.active ? "90 gün uzat" : "Yeniden aç (90 gün)"}
                    </Button>
                    {t.active ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={pending}
                        onClick={() => run(revokeOwnerPortalToken, t.id)}
                      >
                        <XCircle className="h-3.5 w-3.5 text-danger-500" /> İptal et
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-text-muted">
          Bu portföy için henüz malik portalı linki yok.
        </p>
      )}

      {canEdit ? (
        <form onSubmit={generate} className="space-y-3 border-t border-line px-5 py-4">
          <p className="text-xs font-semibold text-ink-950">Yeni link</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-text-muted">
                Malik adı <span className="text-danger-500">*</span>
              </span>
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                maxLength={120}
                placeholder="Örn. Ahmet Yılmaz"
                className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
              />
            </label>
            <div className="block">
              <span className="text-xs font-semibold text-text-muted">
                Telefon <span className="font-medium text-text-faint">(WhatsApp ile göndermek için)</span>
              </span>
              <div className="mt-1">
                <PhoneInput value={ownerPhone} onValueChange={setOwnerPhone} />
              </div>
            </div>
          </div>
          <p className="text-xs text-text-faint">
            Bu portföy için geçerli bir link zaten varsa yenisi üretilmez — mevcut link döner. Link 180 gün geçerlidir.
          </p>
          {error ? <p className="text-sm font-semibold text-danger-500">{error}</p> : null}
          {notice ? <p className="text-sm font-semibold text-mint-700">{notice}</p> : null}
          <Button type="submit" loading={pending}>
            Linki üret
          </Button>
        </form>
      ) : error ? (
        <p className="px-5 pb-4 text-sm font-semibold text-danger-500">{error}</p>
      ) : null}
    </section>
  );
}
