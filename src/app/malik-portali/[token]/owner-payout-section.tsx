import { Scale } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PortalSection } from "@/components/public/portal-kit";
import { loadPortalOwnerStatement } from "@/lib/property-management/portal";
import { OWNER_BALANCE_NOTE, balanceLabel } from "@/lib/property-management/ledger";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/property-management/payments";
import { formatDateTr, formatTryDecimal } from "@/lib/format";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/**
 * Malik paneli "Hakediş ekstresi": aylık tahsilat / yönetim ücreti / gider / ödenen / bakiye ve ödeme geçmişi.
 * Yalnız ofis bu mülkü YÖNETİYORSA çizilir. IBAN, kiracı bilgisi ve danışman notu gösterilmez.
 */
export async function OwnerPayoutSection({ db, tenantId, propertyId }: { db: SupabaseClient; tenantId: string; propertyId: string }) {
  const s = await loadPortalOwnerStatement(db, { tenantId, propertyId });
  if (!s) return null;
  const t = s.ledger.totals;
  const money = (n: number) => formatTryDecimal(n, 2);
  return (
    <PortalSection id="hakedis" icon={Scale} title="Hakediş ekstresi" iconClassName="text-mint-600">
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {[
          { l: "Tahsil edilen kira", v: t.collected },
          { l: `Yönetim ücreti (${s.feeText})`, v: t.fee },
          { l: "Size ödenen", v: t.paidOut },
          { l: balanceLabel(t.balance), v: t.balance },
        ].map((k) => (
          <div key={k.l} className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-3">
            <p className="text-xs text-text-muted">{k.l}</p>
            <p className="mt-0.5 font-bold text-ink-950">{money(k.v)}</p>
          </div>
        ))}
      </div>
      {s.ledger.months.length > 0 ? (
        <>
        {/* Telefon: ay başına kart (yana kaydırma yok); md+ tablo. */}
        <ul className="mt-3 space-y-2 md:hidden" aria-label="Aylık hakediş dökümü">
          {[...s.ledger.months].reverse().map((m) => (
            <li key={m.month} className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink-950">{MONTHS[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(0, 4)}</span>
                <span className="font-semibold tabular-nums text-ink-950">{money(m.entitlement)}</span>
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-text-muted">Tahsilat</dt><dd className="tabular-nums">{money(m.collected)}</dd></div>
                <div><dt className="text-text-muted">Ücret</dt><dd className="tabular-nums">{money(m.fee)}</dd></div>
                <div><dt className="text-text-muted">Gider/aidat</dt><dd className="tabular-nums">{money(m.expenses + m.dues)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
          <table className="w-full text-sm">
            <caption className="sr-only">Aylık hakediş dökümü</caption>
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Dönem</th>
                <th scope="col" className="px-3 py-2 text-right">Tahsilat</th>
                <th scope="col" className="px-3 py-2 text-right">Ücret</th>
                <th scope="col" className="px-3 py-2 text-right">Gider/aidat</th>
                <th scope="col" className="px-3 py-2 text-right">Hakediş</th>
              </tr>
            </thead>
            <tbody>
              {[...s.ledger.months].reverse().map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <td className="px-3 py-2 font-medium text-ink-950">{MONTHS[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(0, 4)}</td>
                  <td className="px-3 py-2 text-right">{money(m.collected)}</td>
                  <td className="px-3 py-2 text-right">{money(m.fee)}</td>
                  <td className="px-3 py-2 text-right">{money(m.expenses + m.dues)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink-950">{money(m.entitlement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-text-muted">Henüz tahsilat kaydı yok.</p>
      )}
      {s.payouts.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-bold text-ink-950">Ödeme geçmişi</h3>
          <ul className="mt-2 space-y-2">
            {s.payouts.slice(0, 12).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-sm">
                <span className="text-ink-950">
                  {formatDateTr(p.paidOn, { day: "2-digit", month: "long", year: "numeric" })} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                  {p.reference ? ` · dekont ${p.reference}` : ""}
                </span>
                <span className="font-bold text-ink-950">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-3 text-xs text-text-faint">Ödeme günü: her ayın {s.payoutDay}. günü. {OWNER_BALANCE_NOTE}</p>
    </PortalSection>
  );
}
