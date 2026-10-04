import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { PageHeader } from "@/components/ui/page-header";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { InvoiceActions } from "../../invoice-actions";
import { BillingNav } from "../../billing-nav";

const invStatus: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
};

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
const dt = (v: string | null) => (v ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v)) : "—");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePlatformModule("billing");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select("id, tenant_id, invoice_no, status, amount_try, tax_try, total_try, currency, period_start, period_end, due_at, paid_at, created_at, iyzico_payment_id, checkout_status, reminder_count, meta, tenant:tenants(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();

  const tenant = Array.isArray(inv.tenant) ? inv.tenant[0] : inv.tenant;
  const meta = (inv.meta ?? {}) as Record<string, unknown>;
  const manual = meta.manual_payment as { method?: string; reference?: string | null; recorded_at?: string } | undefined;
  const voided = meta.voided as { reason?: string; at?: string } | undefined;
  const refund = meta.refund as { amount_try?: number; reason?: string; at?: string } | undefined;

  const rows: [string, string][] = [
    ["Ofis", tenant?.name ?? "—"],
    ["Durum", invStatus[inv.status] ?? inv.status],
    ["Tutar (KDV hariç)", money(Number(inv.amount_try))],
    ["KDV", money(Number(inv.tax_try))],
    ["Toplam", money(Number(inv.total_try))],
    ["Oluşturulma", dt(inv.created_at)],
    ["Vade", dt(inv.due_at)],
    ["Ödeme tarihi", dt(inv.paid_at)],
    ["Dönem", inv.period_start ? `${dt(inv.period_start)} → ${dt(inv.period_end)}` : "—"],
    ["Sağlayıcı ödeme no", inv.iyzico_payment_id ?? "—"],
    ["Hatırlatma sayısı", String(inv.reminder_count ?? 0)],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Faturalama"
        title={inv.invoice_no}
        description={`${tenant?.name ?? "Ofis"} · ${invStatus[inv.status] ?? inv.status}`}
        breadcrumbs={[{ label: "Faturalama", href: "/admin/billing" }, { label: inv.invoice_no }]}
      />
      <BillingNav active="fatura" />

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold text-text-faint">{k}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink-950">{v}</dd>
            </div>
          ))}
        </dl>
        {tenant?.id ? (
          <Link href={`/admin/tenants/${tenant.id}`} className="focus-ring mt-4 inline-block text-xs font-semibold text-brand-600 hover:underline">
            Ofis kaydını aç
          </Link>
        ) : null}
      </section>

      {manual || voided || refund ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 className="font-display font-bold text-ink-950">İşlem geçmişi</h2>
          <ul className="mt-3 space-y-2 text-sm text-text-muted">
            {manual ? (
              <li>
                Elle ödeme kaydı: <strong className="text-ink-950">{manual.method}</strong>
                {manual.reference ? ` · ${manual.reference}` : ""} · {dt(manual.recorded_at ?? null)}
              </li>
            ) : null}
            {voided ? (
              <li>
                İptal: <strong className="text-ink-950">{voided.reason}</strong> · {dt(voided.at ?? null)}
              </li>
            ) : null}
            {refund ? (
              <li>
                İade kaydı: <strong className="text-ink-950">{money(Number(refund.amount_try ?? 0))}</strong> · {refund.reason} · {dt(refund.at ?? null)}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="font-display font-bold text-ink-950">İşlemler</h2>
        <div className="mt-3">
          <InvoiceActions
            invoiceId={inv.id}
            status={inv.status}
            totalTry={Number(inv.total_try)}
            refunded={Boolean(refund)}
            isSuperAdmin={staff.role === "super_admin"}
            today={trDayKey(clockNow())}
          />
        </div>
      </section>
    </div>
  );
}
