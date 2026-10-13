import Link from "@/components/ui/smart-link";
import { CreditCard, History, ShieldCheck } from "lucide-react";
import { formatDateTimeTr, formatDateTr, formatTry } from "@/lib/format";
import type { PaymentProfileData } from "@/lib/billing/subscription-ops";
import { cn } from "@/lib/utils";
import { AutoRenewOffButton } from "./subscription-panel";

/**
 * Ofis 360 > Abonelik: ÖDEME PROFİLİ (salt okunur + otomatik yenilemeyi kapatma). Kart MASKELİ gösterilir (marka, aile,
 * son 4 hane); kart anahtarı/BIN hiç okunmaz. Son 10 tahsil denemesi: ödeme oturumu açılmış faturalar (en yeni önce)
 * ve hata metni (sağlayıcı metni → mutabakat kodu → durumdan türetilen açıklama). Her satır faturaya gider.
 */

const TONE: Record<string, string> = {
  ok: "bg-mint-500/10 text-mint-700",
  warn: "bg-amber-400/12 text-amber-700",
  danger: "bg-danger-500/10 text-danger-600",
  muted: "bg-ink-950/5 text-text-muted",
};

export function PaymentProfilePanel({ tenantId, data }: { tenantId: string; data: PaymentProfileData }) {
  const defaultCard = data.cards.find((c) => c.id === data.autoRenewCardId) ?? data.cards.find((c) => c.isDefault) ?? data.cards[0] ?? null;
  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
          <CreditCard className="h-4 w-4 text-brand-600" /> Ödeme profili
        </h3>
        {data.autoRenewEnabled ? <AutoRenewOffButton tenantId={tenantId} /> : null}
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-text-faint">Otomatik yenileme</dt>
              <dd className="mt-0.5 flex items-center gap-2 font-semibold text-ink-950">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", data.autoRenewEnabled ? TONE.ok : TONE.muted)}>
                  {data.autoRenewEnabled ? "Açık" : "Kapalı"}
                </span>
                {data.autoRenewEnabled && data.autoRenewConsentIso ? (
                  <span className="text-xs font-normal text-text-muted">rıza {formatDateTr(data.autoRenewConsentIso)}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-text-faint">Kayıtlı kart</dt>
              {data.cards.length === 0 ? (
                <dd className="mt-0.5 text-sm text-text-muted">Kayıtlı kart yok.</dd>
              ) : (
                data.cards.map((c) => (
                  <dd key={c.id} className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink-950">
                    <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
                    <span className="numeric">
                      {[c.brand, c.family].filter(Boolean).join(" · ") || "Kart"} •••• {c.lastFour ?? "????"}
                    </span>
                    {c.id === defaultCard?.id ? <span className="text-xs font-normal text-text-muted">(yenileme kartı)</span> : null}
                  </dd>
                ))
              )}
            </div>
          </dl>
          {!data.ready ? <p className="text-xs text-text-muted">Kart/profil tablosu okunamadı; görünüm eksik olabilir.</p> : null}
        </div>

        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-faint">
            <History className="h-3.5 w-3.5" /> Son {data.attempts.length || 10} tahsil denemesi
          </p>
          {data.attempts.length === 0 ? (
            <p className="text-sm text-text-muted">Bu ofiste kartla tahsil denemesi yok.</p>
          ) : (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {data.attempts.map((a) => (
                <li key={a.id} className="relative px-3 py-2 transition hover:bg-brand-600/[0.03]">
                  {a.invoiceId ? (
                    <Link href={`/admin/billing/faturalar/${a.invoiceId}`} className="absolute inset-0" aria-label={`${a.invoiceNo ?? "Fatura"} faturasını aç`} />
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", TONE[a.tone])}>{a.outcome}</span>
                      {a.source}
                    </span>
                    <span className="numeric text-sm font-bold text-ink-950">{formatTry(a.amountTry)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {formatDateTimeTr(a.atIso)} · {a.invoiceNo ?? "—"}
                    {a.errorText ? <span className={a.tone === "danger" ? "text-danger-600" : undefined}> · {a.errorText}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {!data.errorColumn ? (
            <p className="mt-2 text-xs text-text-faint">Sağlayıcı hata metni sütunu henüz kurulmadı; açıklama deneme durumundan türetilir.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
