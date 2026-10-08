import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { formatDateTr, formatTryDecimal } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, formatReceiptNo, remainingAmount, type PaymentMethod } from "@/lib/property-management/payments";

export const metadata = { title: "Tahsilat makbuzu" };

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Kira tahsilat makbuzu (yazdırılabilir). Bilgi makbuzudur; resmî belge (e-makbuz / serbest meslek makbuzu) yerine geçmez.
 * İptal edilmiş tahsilat için makbuz gösterilmez.
 */
export default async function MakbuzPage({ params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { tenantId } = await requireModulePage("rentals", "/app/kiralama");
  const { id, paymentId } = await params;
  const supabase = await createClient();

  const { data: payment } = await supabase
    .from("rent_payments")
    .select("id, amount, paid_on, method, bank_note, receipt_no, voided_at, charge:rent_charges!rent_payments_charge_tenant_fkey(period, amount, paid_amount), rental:rentals!rent_payments_rental_tenant_fkey(id, property:properties!rentals_property_id_fkey(title, property_code), renter:customers!rentals_renter_customer_id_fkey(full_name))")
    .eq("id", paymentId)
    .eq("rental_id", id)
    .eq("tenant_id", tenantId ?? "")
    .maybeSingle();
  if (!payment || payment.voided_at) notFound();

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenantId ?? "").maybeSingle();
  const charge = one(payment.charge as Rel<{ period: string; amount: number; paid_amount: number }>);
  const rental = one(payment.rental as Rel<{ id: string; property: Rel<{ title: string | null; property_code: string }>; renter: Rel<{ full_name: string | null }> }>);
  const property = one(rental?.property ?? null);
  const renter = one(rental?.renter ?? null);
  const period = charge ? new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${String(charge.period).slice(0, 10)}T00:00:00`)) : "—";
  const left = charge ? remainingAmount(Number(charge.amount), Number(charge.paid_amount)) : 0;

  return (
    <main id="main-content" className="mx-auto max-w-xl space-y-5 p-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/app/kiralama/${id}`} className="text-sm font-semibold text-brand-600 hover:underline">← Kira detayı</Link>
      </div>
      <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-xs)] print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{tenant?.name ?? "Ofis"}</p>
            <h1 className="font-display text-xl font-extrabold text-ink-950">Kira tahsilat makbuzu</h1>
          </div>
          <p className="numeric rounded-[var(--radius-control)] bg-canvas px-3 py-1.5 text-sm font-bold text-ink-950">{formatReceiptNo(Number(payment.receipt_no))}</p>
        </header>
        <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-text-muted">Tahsilat tarihi</dt>
          <dd className="font-semibold text-ink-950">{formatDateTr(String(payment.paid_on).slice(0, 10), { day: "2-digit", month: "long", year: "numeric" })}</dd>
          <dt className="text-text-muted">Tahsil edilen</dt>
          <dd className="numeric text-lg font-extrabold text-ink-950">{formatTryDecimal(Number(payment.amount), 2)}</dd>
          <dt className="text-text-muted">Kiracı</dt>
          <dd className="text-ink-950">{renter?.full_name ?? "—"}</dd>
          <dt className="text-text-muted">Portföy</dt>
          <dd className="text-ink-950">{property?.title ?? property?.property_code ?? "—"}</dd>
          <dt className="text-text-muted">Kira dönemi</dt>
          <dd className="text-ink-950">{period}</dd>
          <dt className="text-text-muted">Yöntem</dt>
          <dd className="text-ink-950">{PAYMENT_METHOD_LABELS[payment.method as PaymentMethod] ?? payment.method}</dd>
          {payment.bank_note ? (
            <>
              <dt className="text-text-muted">Banka / açıklama</dt>
              <dd className="text-ink-950">{payment.bank_note}</dd>
            </>
          ) : null}
          <dt className="text-text-muted">Dönem kalan borç</dt>
          <dd className="numeric text-ink-950">{formatTryDecimal(left, 2)}</dd>
        </dl>
        <p className="mt-5 border-t border-line pt-3 text-xs text-text-muted">
          Bu belge ofis kayıtlarındaki tahsilatı gösteren bilgi makbuzudur; resmî belge (serbest meslek makbuzu / e-makbuz) yerine geçmez.
        </p>
      </article>
    </main>
  );
}
