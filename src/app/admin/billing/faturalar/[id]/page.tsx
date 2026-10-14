import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { platformCan } from "@/lib/platform-access";
import { PageHeader } from "@/components/ui/page-header";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { getSetting } from "@/lib/settings/read";
import { canIssueManual, fromRawLine, isManualInvoice, manualCategoryLabel, synthesizeLine, type RawInvoiceLine } from "@/lib/billing/manual-invoice";
import { TBody, TD, TFoot, TH, THead, TR, Table } from "@/components/ui/table";
import { InvoiceActions } from "../../invoice-actions";
import { BillingNav } from "../../billing-nav";
import { DocumentActions } from "./document-actions";
import { ledgerFilterParams } from "@/lib/accounting/ledger";

const invStatus: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
};

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
const dt = (v: string | null) => (v ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v)) : "—");
const day = (v: string | null) => (v ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(v)) : "—");
const pct = (rate: number) => `%${Math.round(rate * 10000) / 100}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Yazdırırken yalnız fatura belgesi basılır (admin kabuğu gizlenir); tarayıcının "PDF olarak kaydet" seçeneğiyle PDF alınır.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #fatura-belgesi, #fatura-belgesi * { visibility: visible !important; }
  #fatura-belgesi { position: absolute; inset: 0 auto auto 0; width: 100%; }
}`;

type CreditNote = { id: string; credit_no: string; amount_try: number; net_try: number; tax_try: number; reason: string; issued_at: string };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePlatformModule("billing");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const admin = createAdminClient();
  const [{ data: inv }, linesRes, notesRes, dueDays] = await Promise.all([
    admin
      .from("invoices")
      .select("id, tenant_id, invoice_no, status, amount_try, tax_try, total_try, currency, period_start, period_end, due_at, paid_at, created_at, iyzico_payment_id, checkout_status, reminder_count, meta, tenant:tenants(id, name, tax_office, tax_number, address_line)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("invoice_lines")
      .select("position, description, quantity, unit_net_try, vat_rate, net_try, tax_try, total_try")
      .eq("invoice_id", id)
      .order("position", { ascending: true }),
    admin
      .from("credit_notes")
      .select("id, credit_no, amount_try, net_try, tax_try, reason, issued_at")
      .eq("invoice_id", id)
      .order("issued_at", { ascending: true }),
    getSetting<number>("billing.manual_invoice_due_days").catch(() => 14),
  ]);
  if (!inv) notFound();

  const tenant = Array.isArray(inv.tenant) ? inv.tenant[0] : inv.tenant;
  const meta = (inv.meta ?? {}) as Record<string, unknown>;
  const manual = meta.manual_payment as { method?: string; reference?: string | null; recorded_at?: string } | undefined;
  const voided = meta.voided as { reason?: string; at?: string } | undefined;
  const refund = meta.refund as { amount_try?: number; reason?: string; at?: string } | undefined;
  const manualInvoice = isManualInvoice(meta) ? (meta.manual_invoice as { category?: string; note?: string | null; issued_at?: string; vat_rate?: number }) : null;
  // Satır tablosu yoksa (migration bekliyor) ya da otomatik fatura satır yazmadıysa tek satır faturadan türetilir.
  const lines = !linesRes.error && (linesRes.data ?? []).length > 0 ? (linesRes.data as unknown as RawInvoiceLine[]).map(fromRawLine) : [synthesizeLine(inv)];
  const creditNotes = notesRes.error ? [] : ((notesRes.data ?? []) as unknown as CreditNote[]);
  const creditTotal = creditNotes.reduce((a, c) => a + Number(c.amount_try), 0);

  const rows: [string, string][] = [
    ["Ofis", tenant?.name ?? "—"],
    ["Durum", invStatus[inv.status] ?? inv.status],
    ["Tür", manualInvoice ? manualCategoryLabel(manualInvoice.category) : "Abonelik / paket"],
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

  const isDraftManual = canIssueManual(inv);

  return (
    <div className="space-y-6">
      <style>{PRINT_CSS}</style>
      <PageHeader
        eyebrow="Faturalama"
        title={inv.invoice_no}
        description={`${tenant?.name ?? "Ofis"} · ${invStatus[inv.status] ?? inv.status}`}
        breadcrumbs={[{ label: "Faturalama", href: "/admin/billing" }, { label: inv.invoice_no }]}
      />
      <BillingNav active="fatura" />

      {isDraftManual ? (
        <div role="status" className="rounded-[var(--radius-card)] border border-warn-500/30 bg-warn-500/10 p-3 text-sm text-warn-600">
          Bu fatura TASLAK: ofise görünmez, borç sayılmaz. Kalemleri kontrol edip &quot;Faturayı kes&quot; ile kesin.
          {typeof manualInvoice?.vat_rate === "number" ? ` Taslak KDV oranı ${pct(manualInvoice.vat_rate)}.` : ""}
        </div>
      ) : null}

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

      <section id="fatura-belgesi" aria-labelledby="belge-baslik" className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 print:border-0 print:bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">EmlakSoft · Fatura</p>
            <h2 id="belge-baslik" className="font-display text-lg font-bold text-ink-950">{inv.invoice_no}</h2>
            <p className="text-xs text-text-muted">
              Tarih {day(manualInvoice?.issued_at ?? inv.created_at)}
              {inv.due_at ? ` · Son ödeme ${day(inv.due_at)}` : ""} · {invStatus[inv.status] ?? inv.status}
            </p>
          </div>
          <div className="text-right text-xs text-text-muted">
            <p className="text-sm font-semibold text-ink-950">{tenant?.name ?? "Ofis"}</p>
            {tenant?.tax_office || tenant?.tax_number ? (
              <p>
                {tenant?.tax_office ?? ""} {tenant?.tax_number ? `· VKN/TCKN ${tenant.tax_number}` : ""}
              </p>
            ) : null}
            {tenant?.address_line ? <p>{tenant.address_line}</p> : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full min-w-[36rem] text-left text-xs">
            <caption className="sr-only">Fatura kalemleri</caption>
            <THead className="text-text-faint">
              <TR>
                <TH scope="col" className="py-1.5 pr-3 font-semibold">#</TH>
                <TH scope="col" className="py-1.5 pr-3 font-semibold">Açıklama</TH>
                <TH scope="col" className="py-1.5 pr-3 text-right font-semibold">Miktar</TH>
                <TH scope="col" className="py-1.5 pr-3 text-right font-semibold">Birim (KDV hariç)</TH>
                <TH scope="col" className="py-1.5 pr-3 text-right font-semibold">KDV</TH>
                <TH scope="col" className="py-1.5 text-right font-semibold">Toplam</TH>
              </TR>
            </THead>
            <TBody className="divide-y divide-line">
              {lines.map((l) => (
                <TR key={l.position}>
                  <TD className="py-1.5 pr-3">{l.position}</TD>
                  <TD className="py-1.5 pr-3 font-medium text-ink-950">{l.description}</TD>
                  <TD className="py-1.5 pr-3 text-right">{l.quantity.toLocaleString("tr-TR")}</TD>
                  <TD className="py-1.5 pr-3 text-right">{money(l.unitNetTry)}</TD>
                  <TD className="py-1.5 pr-3 text-right">
                    {money(l.taxTry)} <span className="text-text-faint">({pct(l.vatRate)})</span>
                  </TD>
                  <TD className="py-1.5 text-right font-semibold text-ink-950">{money(l.totalTry)}</TD>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={5} className="py-1.5 pr-3 text-right text-text-muted">Ara toplam (KDV hariç)</TD>
                <TD className="py-1.5 text-right">{money(Number(inv.amount_try))}</TD>
              </TR>
              <TR>
                <TD colSpan={5} className="py-1.5 pr-3 text-right text-text-muted">KDV</TD>
                <TD className="py-1.5 text-right">{money(Number(inv.tax_try))}</TD>
              </TR>
              <TR>
                <TD colSpan={5} className="py-1.5 pr-3 text-right font-semibold text-ink-950">Genel toplam</TD>
                <TD className="py-1.5 text-right font-bold text-ink-950">{money(Number(inv.total_try))}</TD>
              </TR>
              {creditTotal > 0 ? (
                <TR>
                  <TD colSpan={5} className="py-1.5 pr-3 text-right text-danger-600">Alacak dekontları</TD>
                  <TD className="py-1.5 text-right text-danger-600">−{money(creditTotal)}</TD>
                </TR>
              ) : null}
            </TFoot>
          </Table>
        </div>
        <div className="print:hidden">
          <DocumentActions
            invoiceId={inv.id}
            canIssue={isDraftManual}
            canDelete={isDraftManual}
            canEmail={inv.status !== "draft"}
            totalLabel={money(Number(inv.total_try))}
            dueDays={Number(dueDays)}
          />
        </div>
      </section>

      {creditNotes.length > 0 ? (
        <section aria-labelledby="dekont-baslik" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 id="dekont-baslik" className="font-display font-bold text-ink-950">Alacak dekontları</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {creditNotes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong className="text-ink-950">{c.credit_no}</strong>
                  <span className="text-text-muted"> · {dt(c.issued_at)}{c.reason ? ` · ${c.reason}` : ""}</span>
                </span>
                <span className="numeric font-semibold text-danger-600">
                  −{money(Number(c.amount_try))}
                  <span className="ml-1 text-xs font-normal text-text-faint">(net {money(Number(c.net_try))} · KDV {money(Number(c.tax_try))})</span>
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/admin/muhasebe/defter?${new URLSearchParams({ donem: "tumu", ...ledgerFilterParams({ durum: "dekont", q: inv.invoice_no }) })}`} className="focus-ring mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline">
            Defterde göster
          </Link>
        </section>
      ) : null}

      {manual || voided || refund || manualInvoice?.note ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 className="font-display font-bold text-ink-950">İşlem geçmişi</h2>
          <ul className="mt-3 space-y-2 text-sm text-text-muted">
            {manualInvoice?.note ? (
              <li>
                İç not: <strong className="text-ink-950">{manualInvoice.note}</strong>
              </li>
            ) : null}
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
        <p className="mt-1 text-xs text-text-faint">İade kaydı (kısmi ya da tam) numaralı alacak dekontu üretir ve fatura defterinde eksi satır olarak görünür.</p>
        {isDraftManual ? (
          // Taslak > kesildi akışı atlanmasın: kesilmemiş elle taslak ödendi/iptal işaretlenemez; önce "Faturayı kes".
          <p role="status" className="mt-3 text-sm text-text-muted">
            Bu fatura henüz kesilmedi. Ödeme kaydı ve diğer işlemler için önce yukarıdaki &quot;Faturayı kes&quot; düğmesini kullanın.
          </p>
        ) : (
          <div className="mt-3">
            <InvoiceActions
              invoiceId={inv.id}
              status={inv.status}
              totalTry={Number(inv.total_try)}
              refunded={Boolean(refund)}
              chargedBack={Boolean(meta.chargeback)}
              isSuperAdmin={platformCan(staff, "billing", "approve")}
              today={trDayKey(clockNow())}
            />
          </div>
        )}
      </section>
    </div>
  );
}
