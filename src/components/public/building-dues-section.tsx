import type { SupabaseClient } from "@supabase/supabase-js";
import { Building2 } from "lucide-react";
import { PortalSection } from "@/components/public/portal-kit";
import { BUILDING_PAYMENT_METHOD_LABELS, BUILDING_STATUS_LABELS, deriveBuildingChargeStatus } from "@/lib/building-management/charges";
import { loadPortalCustomerDues } from "@/lib/building-management/load";
import { cariBalanceLabel } from "@/lib/building-management/unit-ledger";
import { formatDateTr, formatTryDecimal } from "@/lib/format";

/**
 * Malik / kiracı portalı "Bina aidatım" bölümü (SALT-OKUNUR). Yalnız izleyenin ÖDEYEN olduğu daire tahakkukları ve ödemeleri gelir;
 * başka dairenin verisi, makbuz ayrıntısı ve ofisin yönetim ücreti GÖSTERİLMEZ. Bina yönetimi kaydı yoksa bölüm çizilmez.
 * `today` (TR günü) dışarıdan verilir (bileşende saat okunmaz).
 */
export async function BuildingDuesSection({
  db,
  tenantId,
  role,
  today,
  customerId,
  propertyId,
}: {
  db: SupabaseClient;
  tenantId: string;
  role: "owner" | "tenant";
  today: string;
  customerId?: string;
  propertyId?: string;
}) {
  const units = await loadPortalCustomerDues(db, { tenantId, role, customerId, propertyId });
  if (!units || units.length === 0) return null;
  const money = (n: number) => formatTryDecimal(n, 2);
  return (
    <PortalSection id="bina-aidat" icon={Building2} title="Bina aidatım" iconClassName="text-brand-600">
      <div className="space-y-3">
        {units.map((u) => (
          <div key={u.unitId} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <p className="text-sm font-semibold text-ink-950">{u.title}</p>
              <p className="text-xs text-text-muted">
                {cariBalanceLabel(u.balance)}: <span className="numeric font-bold text-ink-950">{money(Math.abs(u.balance))}</span>
              </p>
            </div>
            {u.charges.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line text-sm">
                {u.charges.map((c) => {
                  const status = deriveBuildingChargeStatus({ amount: c.amount, paid: c.paid, dueDate: c.dueDate, today });
                  const tone = status === "paid" ? "bg-mint-500/12 text-mint-700" : status === "overdue" ? "bg-danger-500/10 text-danger-600" : "bg-amber-400/15 text-amber-700";
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-ink-950">{c.title}</span>
                        <span className="block text-xs text-text-muted">Vade {formatDateTr(c.dueDate, { day: "2-digit", month: "long", year: "numeric" })}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="numeric tabular-nums text-ink-950">{money(c.amount)}</span>
                        {c.paid > 0 && c.paid < c.amount ? <span className="numeric text-xs text-text-muted">ödenen {money(c.paid)}</span> : null}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>{BUILDING_STATUS_LABELS[status]}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="border-t border-line px-4 py-3 text-xs text-text-muted">Henüz aidat tahakkuku yok.</p>
            )}
            {u.payments.length > 0 ? (
              <div className="border-t border-line bg-canvas px-4 py-2.5">
                <p className="text-xs font-semibold text-ink-950">Ödemeleriniz</p>
                <ul className="mt-1 space-y-1 text-xs text-text-muted">
                  {u.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span>{formatDateTr(p.paidOn, { day: "2-digit", month: "long", year: "numeric" })} · {BUILDING_PAYMENT_METHOD_LABELS[p.method] ?? p.method}</span>
                      <span className="numeric font-semibold text-ink-950">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </PortalSection>
  );
}
