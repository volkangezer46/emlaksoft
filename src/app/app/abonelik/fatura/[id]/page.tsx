import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PrintButton } from "./print-button";

export const metadata = { title: "Fatura" };

const STATUS: Record<string, string> = {
  draft: "Taslak",
  open: "Ödeme bekliyor",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemedi",
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 }).format(n);
}
function day(iso: string | null) {
  return iso ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(iso)) : "—";
}

/** Yazdırılabilir fatura özeti (PDF için tarayıcıdan "PDF olarak kaydet"). Tenant RLS ile süzülür. */
export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await requireModulePage("billing");
  const { id } = await params;
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: inv }, { data: tenant }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, invoice_no, status, amount_try, tax_try, total_try, currency, period_start, period_end, due_at, paid_at, iyzico_payment_id, created_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase.from("tenants").select("name, tax_number, address_line, city").eq("id", tenantId).maybeSingle(),
  ]);
  if (!inv) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/app/abonelik?sekme=faturalar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> Faturalar
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-xs)] print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">EmlakSoft abonelik faturası</p>
            <h1 className="mt-1 font-display text-2xl font-extrabold text-ink-950">{inv.invoice_no}</h1>
          </div>
          <span className="rounded-full bg-brand-600/10 px-3 py-1 text-xs font-bold text-brand-700">{STATUS[inv.status] ?? inv.status}</span>
        </header>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-text-muted">Fatura edilen</dt>
            <dd className="font-semibold text-ink-950">{tenant?.name ?? "—"}</dd>
            {tenant?.tax_number ? <dd className="text-text-muted">Vergi/TC no: {tenant.tax_number}</dd> : null}
            {tenant?.address_line || tenant?.city ? (
              <dd className="text-text-muted">{[tenant?.address_line, tenant?.city].filter(Boolean).join(", ")}</dd>
            ) : null}
          </div>
          <div>
            <dt className="text-xs text-text-muted">Tarihler</dt>
            <dd>Kesim: {day(inv.created_at)}</dd>
            <dd>Dönem: {day(inv.period_start)} – {day(inv.period_end)}</dd>
            <dd>Son ödeme: {day(inv.due_at)}</dd>
            <dd>Ödeme: {day(inv.paid_at)}</dd>
          </div>
        </dl>

        <table className="mt-6 w-full text-sm">
          <tbody>
            <tr className="border-t border-line">
              <td className="py-2 text-text-muted">Ara tutar</td>
              <td className="py-2 text-right tabular-nums">{money(Number(inv.amount_try))}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="py-2 text-text-muted">KDV</td>
              <td className="py-2 text-right tabular-nums">{money(Number(inv.tax_try))}</td>
            </tr>
            <tr className="border-t border-line font-bold text-ink-950">
              <td className="py-2">Toplam</td>
              <td className="py-2 text-right tabular-nums">{money(Number(inv.total_try))}</td>
            </tr>
          </tbody>
        </table>

        {inv.iyzico_payment_id ? (
          <p className="mt-4 text-xs text-text-faint">Ödeme referansı: {inv.iyzico_payment_id}</p>
        ) : null}
        <p className="mt-6 text-xs text-text-faint print:mt-10">
          Bu sayfa ödeme özetidir; resmi e-fatura/e-arşiv belgesi ayrıca iletilir.
        </p>
      </article>
    </div>
  );
}
