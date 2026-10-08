import { Button } from "@/components/ui/button";
import { ReportOpenLink } from "@/components/report-center/report-open-link";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, FileText, X } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { PageHeader } from "@/components/ui/page-header";
import { AdminEmpty } from "@/components/admin/admin-table";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { now as clockNow } from "@/lib/clock";
import { csvDate } from "@/lib/accounting/csv";
import { resolvePeriod, periodSearchParams } from "@/lib/accounting/period";
import {
  INVOICE_KINDS,
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  LEDGER_STATUS_FILTERS,
  LEDGER_STATUS_FILTER_LABELS,
  PAYMENT_METHOD_CODES,
  PAYMENT_METHOD_LABELS,
  ledgerFilterParams,
  matchesLedger,
  parseLedgerFilter,
  totalsOf,
  isOverdue,
  type LedgerParams,
} from "@/lib/accounting/ledger";
import { formatKurus } from "@/lib/accounting/format";
import { loadLedger, LEDGER_MAX_ROWS } from "@/lib/accounting/loaders";
import { BillingNav } from "@/app/admin/billing/billing-nav";
import { PeriodBar } from "../period-bar";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400";

export default async function FaturaDefteriPage({ searchParams }: { searchParams?: Promise<LedgerParams> }) {
  await requirePlatformModule("billing");
  const sp = (await searchParams) ?? {};
  const nowMs = clockNow();
  const period = resolvePeriod(sp, nowMs);
  const filter = parseLedgerFilter(sp);
  const page = parsePage(sp.sayfa);

  const admin = createAdminClient();
  const loaded = await loadLedger(admin, period, { withRefunds: filter.durum === "iade" }).catch(() => null);
  const rows = (loaded?.rows ?? []).filter((r) => matchesLedger(r, filter, period, nowMs));
  const totals = totalsOf(rows);
  const [from, to] = pageRange(page);
  const visible = rows.slice(from, to + 1);

  const periodQs = periodSearchParams(period);
  const filterQs = ledgerFilterParams(filter);
  const href = (extra: Record<string, string>, drop: string[] = []) => {
    const merged: Record<string, string> = { ...periodQs, ...filterQs, ...extra };
    for (const k of drop) delete merged[k];
    return `/admin/muhasebe/defter?${new URLSearchParams(merged).toString()}`;
  };
  // Rapor merkezi muhasebe defteri: dönem + rapordaki süzgeçler (ofis / kupon / tutar aralığı sayfaya özgüdür).
  const exportFilters: Record<string, string | undefined> = { ...periodQs, durum: filterQs.durum, tur: filterQs.tur, yontem: filterQs.yontem, q: filterQs.q };

  const chips: { label: string; href: string }[] = [];
  if (filter.durum) chips.push({ label: `Durum: ${LEDGER_STATUS_FILTER_LABELS[filter.durum]}`, href: href({}, ["durum"]) });
  if (filter.tur) chips.push({ label: `Tür: ${INVOICE_KIND_LABELS[filter.tur]}`, href: href({}, ["tur"]) });
  if (filter.yontem) chips.push({ label: `Yöntem: ${PAYMENT_METHOD_LABELS[filter.yontem]}`, href: href({}, ["yontem"]) });
  if (filter.kupon) chips.push({ label: "Yalnız kuponlu", href: href({}, ["kupon"]) });
  if (filter.ofis) chips.push({ label: "Tek ofis", href: href({}, ["ofis"]) });
  if (filter.q) chips.push({ label: `Arama: ${filter.q}`, href: href({}, ["q"]) });
  if (filter.minKurus !== undefined || filter.maxKurus !== undefined) {
    chips.push({
      label: `Tutar: ${filter.minKurus !== undefined ? formatKurus(filter.minKurus) : "…"} – ${filter.maxKurus !== undefined ? formatKurus(filter.maxKurus) : "…"}`,
      href: href({}, ["min", "max"]),
    });
  }

  return (
    <div className="space-y-6">
      <BillingNav active="defter" />
      <PageHeader
        eyebrow="Muhasebe"
        title="Fatura defteri"
        description="Dönem ve süzgeçlere göre fatura listesi. Satıra tıklayınca fatura detayı ve işlemler açılır."
        breadcrumbs={[{ label: "Muhasebe", href: "/admin/muhasebe" }, { label: "Fatura defteri" }]}
        actions={
          <ReportOpenLink scope="platform" report="muhasebe-fatura-defteri" filters={exportFilters} label="Raporlarda aç (bu liste)" />
        }
      />

      <PeriodBar basePath="/admin/muhasebe/defter" period={period} keep={filterQs} />

      <form action="/admin/muhasebe/defter" className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        {Object.entries(periodQs).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {filter.ofis ? <input type="hidden" name="ofis" value={filter.ofis} /> : null}
        {filter.kupon ? <input type="hidden" name="kupon" value="1" /> : null}
        <label className="text-xs font-semibold text-text-muted">
          Durum
          <select name="durum" defaultValue={filter.durum ?? ""} className={selectClass}>
            <option value="">Tümü</option>
            {LEDGER_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{LEDGER_STATUS_FILTER_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Tür
          <select name="tur" defaultValue={filter.tur ?? ""} className={selectClass}>
            <option value="">Tümü</option>
            {INVOICE_KINDS.map((k) => (
              <option key={k} value={k}>{INVOICE_KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Ödeme yöntemi
          <select name="yontem" defaultValue={filter.yontem ?? ""} className={selectClass}>
            <option value="">Tümü</option>
            {PAYMENT_METHOD_CODES.map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Ofis veya fatura no
          <input name="q" defaultValue={filter.q ?? ""} maxLength={80} placeholder="Ara…" className={`${selectClass} w-44`} />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          En az (₺)
          <input name="min" inputMode="decimal" defaultValue={sp.min ?? ""} className={`${selectClass} w-24`} />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          En çok (₺)
          <input name="max" inputMode="decimal" defaultValue={sp.max ?? ""} className={`${selectClass} w-24`} />
        </label>
        <Button variant="navy" size="sm" type="submit">
          Süz
        </Button>
      </form>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              {c.label} <X className="h-3 w-3" />
              <span className="sr-only">süzgeci kaldır</span>
            </Link>
          ))}
          <Link href="/admin/muhasebe/defter" className="focus-ring text-xs font-semibold text-text-muted hover:text-ink-950">Hepsini temizle</Link>
        </div>
      ) : null}

      {!loaded ? (
        <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-warn-500/30 bg-warn-500/10 p-3 text-sm text-warn-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Fatura verisi okunamadı. Sayfayı yenileyin.</p>
        </div>
      ) : null}
      {loaded?.truncated ? (
        <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-warn-500/30 bg-warn-500/10 p-3 text-sm text-warn-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{LEDGER_MAX_ROWS.toLocaleString("tr-TR")} satır sınırı aşıldı; liste eksik. Dönemi daraltın.</p>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <FileText className="h-4 w-4 text-brand-600" /> Faturalar
            <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">{rows.length}</span>
          </h2>
          <p className="text-xs text-text-muted">
            Net {formatKurus(totals.net)} · KDV {formatKurus(totals.tax)} · Brüt <strong className="text-ink-950">{formatKurus(totals.gross)}</strong>
          </p>
        </div>
        {visible.length === 0 ? (
          <AdminEmpty
            icon={FileText}
            title="Bu süzgeçle fatura yok"
            description="Dönemi genişletin ya da süzgeçleri kaldırın."
          />
        ) : (
          <div className="divide-y divide-line">
            {visible.map((inv) => (
              <div key={inv.id} className="group relative grid gap-2 px-5 py-3 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1.2fr_.8fr_.8fr_.8fr] sm:items-center">
                <Link href={`/admin/billing/faturalar/${inv.id}`} className="absolute inset-0" aria-label={`${inv.invoiceNo} fatura detayını aç`} />
                <div>
                  <p className="text-sm font-semibold text-ink-950">{inv.invoiceNo}</p>
                  <Link href={`/admin/tenants/${inv.tenantId}`} className="focus-ring relative z-10 text-xs text-text-muted hover:text-brand-600">
                    {inv.tenantName || "Ofis"}
                  </Link>
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink-950">{formatKurus(inv.grossKurus)}</p>
                  <p className="text-xs text-text-faint">Net {formatKurus(inv.netKurus)} · KDV {formatKurus(inv.taxKurus)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-fit rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">
                    {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                  </span>
                  {isOverdue(inv, nowMs) ? (
                    <span className="w-fit rounded-full bg-danger-500/10 px-2.5 py-1 text-xs font-bold text-danger-600">Gecikmiş</span>
                  ) : null}
                  {inv.refundKurus > 0 ? (
                    <span className="w-fit rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">
                      İade {formatKurus(inv.refundKurus)}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-text-muted">
                  <p>{INVOICE_KIND_LABELS[inv.kind]} · {PAYMENT_METHOD_LABELS[inv.method]}</p>
                  <p className="text-text-faint">
                    {inv.paidAt ? `Ödeme ${csvDate(inv.paidAt)}` : `Oluşturma ${csvDate(inv.createdAt)}`}
                    {inv.couponCode ? ` · Kupon ${inv.couponCode}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="px-5 py-4">
          <Pagination page={page} total={rows.length} hrefFor={(p) => href({ sayfa: String(p) })} />
        </div>
      </section>
    </div>
  );
}
