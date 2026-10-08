import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { formatDateTr, formatTryDecimal } from "@/lib/format";
import { BUILDING_PAYMENT_METHOD_LABELS, PAYER_LABELS } from "@/lib/building-management/charges";
import { remainingAmount, formatReceiptNo } from "@/lib/property-management/payments";
import { unitLabel } from "@/lib/building-management/distribution";

export const metadata = { title: "Aidat tahsilat makbuzu" };

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Bina aidatı / gider payı tahsilat makbuzu (yazdırılabilir). Bilgi makbuzudur; resmî belge (e-makbuz / serbest meslek makbuzu)
 * yerine geçmez. İptal edilmiş tahsilat için makbuz gösterilmez. Makbuz numarası kira makbuzlarıyla aynı ofis sayacındandır.
 */
export default async function AidatMakbuzPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { tenantId } = await requireModulePage("expenses", "/app/aidat");
  const { paymentId } = await params;
  const supabase = await createClient();

  const { data: payment } = await supabase
    .from("building_payments")
    .select(
      "id, amount, paid_on, method, bank_note, receipt_no, voided_at, charge:building_charges!building_payments_charge_tenant_fkey(amount, paid_amount, payer_role, batch:building_charge_batches!building_charges_batch_tenant_fkey(title, period)), unit:building_units!building_payments_unit_tenant_fkey(block, unit_no, owner:customers!building_units_owner_customer_fkey(full_name), renter:customers!building_units_tenant_customer_fkey(full_name)), building:buildings!building_payments_building_tenant_fkey(name)",
    )
    .eq("id", paymentId)
    .eq("tenant_id", tenantId ?? "")
    .maybeSingle();
  if (!payment || payment.voided_at) notFound();

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenantId ?? "").maybeSingle();
  const charge = one(payment.charge as Rel<{ amount: number; paid_amount: number; payer_role: "owner" | "tenant"; batch: Rel<{ title: string; period: string }> }>);
  const batch = one(charge?.batch ?? null);
  const unit = one(payment.unit as Rel<{ block: string | null; unit_no: string; owner: Rel<{ full_name: string | null }>; renter: Rel<{ full_name: string | null }> }>);
  const building = one(payment.building as Rel<{ name: string }>);
  const payerName = charge?.payer_role === "tenant" ? one(unit?.renter ?? null)?.full_name : one(unit?.owner ?? null)?.full_name;
  const period = batch ? new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${String(batch.period).slice(0, 10)}T00:00:00`)) : "—";
  const left = charge ? remainingAmount(Number(charge.amount), Number(charge.paid_amount)) : 0;

  return (
    <main id="main-content" className="mx-auto max-w-xl space-y-5 p-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/aidat?sekme=binalar" className="text-sm font-semibold text-brand-600 hover:underline">← Bina yönetimi</Link>
      </div>
      <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-xs)] print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{tenant?.name ?? "Ofis"}</p>
            <h1 className="font-display text-xl font-extrabold text-ink-950">Aidat tahsilat makbuzu</h1>
          </div>
          <p className="numeric rounded-[var(--radius-control)] bg-canvas px-3 py-1.5 text-sm font-bold text-ink-950">{formatReceiptNo(Number(payment.receipt_no))}</p>
        </header>
        <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-text-muted">Tahsilat tarihi</dt>
          <dd className="font-semibold text-ink-950">{formatDateTr(String(payment.paid_on).slice(0, 10), { day: "2-digit", month: "long", year: "numeric" })}</dd>
          <dt className="text-text-muted">Tahsil edilen</dt>
          <dd className="numeric text-lg font-extrabold text-ink-950">{formatTryDecimal(Number(payment.amount), 2)}</dd>
          <dt className="text-text-muted">Bina / site</dt>
          <dd className="text-ink-950">{building?.name ?? "—"}</dd>
          <dt className="text-text-muted">Daire</dt>
          <dd className="text-ink-950">{unit ? unitLabel({ block: unit.block, unitNo: unit.unit_no }) : "—"}</dd>
          <dt className="text-text-muted">Ödeyen ({charge ? PAYER_LABELS[charge.payer_role] : "—"})</dt>
          <dd className="text-ink-950">{payerName ?? "—"}</dd>
          <dt className="text-text-muted">Konu</dt>
          <dd className="text-ink-950">{batch?.title ?? "Aidat"} · {period}</dd>
          <dt className="text-text-muted">Yöntem</dt>
          <dd className="text-ink-950">{BUILDING_PAYMENT_METHOD_LABELS[String(payment.method)] ?? payment.method}</dd>
          {payment.bank_note ? (
            <>
              <dt className="text-text-muted">Banka / açıklama</dt>
              <dd className="text-ink-950">{payment.bank_note}</dd>
            </>
          ) : null}
          <dt className="text-text-muted">Tahakkuk kalan borç</dt>
          <dd className="numeric text-ink-950">{formatTryDecimal(left, 2)}</dd>
        </dl>
        <p className="mt-5 border-t border-line pt-3 text-xs text-text-muted">
          Bu belge ofis kayıtlarındaki tahsilatı gösteren bilgi makbuzudur; resmî belge (serbest meslek makbuzu / e-makbuz) yerine geçmez.
        </p>
      </article>
    </main>
  );
}
