import Link from "next/link";
import { AlertTriangle, Download, FileSpreadsheet, Info } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { getPlatformSetting } from "@/lib/platform-settings";
import { resolvePeriod, periodSearchParams, type PeriodParams } from "@/lib/accounting/period";
import {
  INVOICE_KINDS,
  INVOICE_KIND_LABELS,
  PAYMENT_METHOD_CODES,
  PAYMENT_METHOD_LABELS,
  isCollectedIn,
  summarizeLedger,
} from "@/lib/accounting/ledger";
import { ACCOUNTING_EXPORT_PATH } from "@/lib/accounting/csv";
import { formatKurus, formatKurusShort } from "@/lib/accounting/format";
import {
  EF_ITEM_LABELS,
  EF_WHOLESALE_SETTING_KEY,
  computeEfEconomics,
  parseEfWholesale,
} from "@/lib/accounting/ef-economics";
import { loadEfUsage, loadLedger, loadOpenInvoices, loadPlatformMrr, loadSubscriptionMovement, loadTryLiability, LEDGER_MAX_ROWS } from "@/lib/accounting/loaders";
import { saveEfWholesale } from "@/app/actions/accounting";
import { InlineOp, opFieldClass } from "@/app/admin/billing/inline-op";
import { BillingNav } from "@/app/admin/billing/billing-nav";
import { PeriodBar } from "./period-bar";
import { RankedBars } from "@/components/admin/admin-bars";
import { TrendPill, computeTrend } from "@/components/ui/premium";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

function defterHref(period: ReturnType<typeof resolvePeriod>, extra: Record<string, string> = {}, ignorePeriod = false) {
  const base = ignorePeriod ? { donem: "tumu" } : periodSearchParams(period);
  return `/admin/muhasebe/defter?${new URLSearchParams({ ...base, ...extra }).toString()}`;
}

export default async function MuhasebePage({ searchParams }: { searchParams?: Promise<PeriodParams> }) {
  const staff = await requirePlatformModule("billing");
  const sp = (await searchParams) ?? {};
  const nowMs = clockNow();
  const period = resolvePeriod(sp, nowMs);
  const isSuper = staff.role === "super_admin";
  const admin = createAdminClient();

  let loadError = false;
  const [ledgerRes, openRes, mrr, wholesaleRaw, efUsage, tryLiability] = await Promise.all([
    loadLedger(admin, period, { withRefunds: true }).catch(() => null),
    loadOpenInvoices(admin).catch(() => null),
    loadPlatformMrr(admin, nowMs).catch(() => null),
    getPlatformSetting(EF_WHOLESALE_SETTING_KEY),
    loadEfUsage(admin, period),
    loadTryLiability(admin).catch(() => null),
  ]);
  if (!ledgerRes || !openRes) loadError = true;

  const ledger = ledgerRes ?? { rows: [], truncated: false };
  const summary = summarizeLedger(ledger.rows, openRes ?? [], period, nowMs);
  const planTenantIds = ledger.rows.filter((r) => isCollectedIn(r, period) && r.kind === "plan").map((r) => r.tenantId);
  const movement = await loadSubscriptionMovement(admin, period, planTenantIds).catch(() => null);

  // Dönem karşılaştırması: aynı uzunlukta bir önceki dönem (yalnız iki ucu belli dönemlerde; "tüm zamanlar" karşılaştırılmaz).
  let prevSummary: ReturnType<typeof summarizeLedger> | null = null;
  if (period.fromIso && period.toIso) {
    const fromMs = Date.parse(period.fromIso);
    const toMs = Date.parse(period.toIso);
    const prevPeriod = { ...period, fromIso: new Date(fromMs - (toMs - fromMs)).toISOString(), toIso: period.fromIso, fromDay: null, toDay: null };
    const prevLedger = await loadLedger(admin, prevPeriod, { withRefunds: true }).catch(() => null);
    if (prevLedger && !prevLedger.truncated) prevSummary = summarizeLedger(prevLedger.rows, openRes ?? [], prevPeriod, nowMs);
  }
  const comparison = prevSummary
    ? [
        { label: "Tahsilat (brüt)", cur: summary.collected.gross, prev: prevSummary.collected.gross, invert: false, href: defterHref(period, { durum: "paid" }) },
        { label: "Tahsilat net (KDV hariç)", cur: summary.collected.net, prev: prevSummary.collected.net, invert: false, href: defterHref(period, { durum: "paid" }) },
        { label: "İade", cur: summary.refunds.gross, prev: prevSummary.refunds.gross, invert: true, href: defterHref(period, { durum: "iade" }) },
      ]
    : [];

  const wholesale = parseEfWholesale(wholesaleRaw);
  const econ = computeEfEconomics(efUsage.rows, wholesale, summary.byKind.credit_pack.net);

  // /admin/billing tarih süzgeci TR gün anahtarı ister (alt dahil, üst dahil).
  const billingRange: Record<string, string> = {};
  if (period.fromIso) billingRange.from = trDayKey(Date.parse(period.fromIso));
  if (period.toIso) billingRange.to = trDayKey(Date.parse(period.toIso) - 1);
  const billingHref = (extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ ...billingRange, ...extra }).toString();
    return qs ? `/admin/billing?${qs}` : "/admin/billing";
  };

  const items: StatRowItem[] = [
    {
      label: "Tahsilat (brüt)",
      value: formatKurusShort(summary.collected.gross),
      href: defterHref(period, { durum: "paid" }),
      hint: `${summary.collected.count} ödenen fatura`,
    },
    {
      label: "Tahsilat net (KDV hariç)",
      value: formatKurusShort(summary.collected.net),
      href: defterHref(period, { durum: "paid" }),
    },
    {
      label: "KDV",
      value: formatKurusShort(summary.collected.tax),
      href: defterHref(period, { durum: "paid" }),
    },
    {
      label: "İade",
      value: formatKurusShort(summary.refunds.gross),
      href: defterHref(period, { durum: "iade" }),
      hint: `${summary.refunds.count} fatura`,
      attention: summary.refunds.count > 0,
    },
    {
      label: "İade sonrası tahsilat",
      value: formatKurusShort(summary.netOfRefundsGross),
      href: defterHref(period, { durum: "paid" }),
      hint: "brüt − iade",
    },
    {
      label: "Bekleyen",
      value: formatKurusShort(summary.pending.gross),
      href: defterHref(period, { durum: "open" }, true),
      hint: `${summary.pending.count} açık fatura (güncel)`,
    },
    {
      label: "Gecikmiş",
      value: formatKurusShort(summary.overdue.gross),
      href: defterHref(period, { durum: "gecikmis" }, true),
      hint: `${summary.overdue.count} fatura (güncel)`,
      attention: summary.overdue.count > 0,
    },
    {
      label: "Kupon indirimi",
      value: formatKurusShort(summary.coupon.discountKurus),
      href: defterHref(period, { durum: "paid", kupon: "1" }),
      hint: `${summary.coupon.count} kuponlu fatura`,
    },
    {
      label: "Hesap kredisi ile ödenen",
      value: formatKurusShort(summary.walletCreditKurus),
      href: defterHref(period, { durum: "paid", yontem: "hesap_kredisi" }),
      hint: "tamamı kredi ile ödenen faturalar (karma ödemelerin kredi payı toplama dahil)",
    },
    {
      label: "Kullanılmamış hesap kredisi",
      value: tryLiability ? formatKurusShort(tryLiability.totalKurus) : "—",
      href: "#hesap-kredisi",
      hint: tryLiability ? `${tryLiability.tenantCount} ofis · yükümlülük (güncel)` : "okunamadı",
    },
  ];

  const subItems: StatRowItem[] = [
    {
      label: "Yeni abonelik",
      value: movement ? movement.created : "—",
      href: billingHref(),
      hint: "dönemde açılan kayıt",
    },
    {
      label: "Yenileyen ofis",
      value: movement ? (movement.renewing ?? "—") : "—",
      href: defterHref(period, { durum: "paid", tur: "plan" }),
      hint: movement?.renewing === null ? "tüm zamanlarda hesaplanmaz" : "daha önce de plan ödemiş",
    },
    {
      label: "İptal",
      value: movement ? movement.cancelled : "—",
      href: billingHref({ durum: "cancelled" }),
      hint: "dönemde iptal edilen",
    },
    {
      label: "MRR",
      value: mrr ? formatKurusShort(mrr.mrr * 100) : "—",
      href: "/admin/billing?durum=active",
      hint: "aylık yinelenen gelir (güncel)",
    },
    {
      label: "ARR",
      value: mrr ? formatKurusShort(mrr.arr * 100) : "—",
      href: "/admin/billing?durum=active",
      hint: "MRR × 12 (güncel)",
    },
  ];

  const exportQs = new URLSearchParams(periodSearchParams(period)).toString();
  const creditSoldNet = summary.byKind.credit_pack.net;

  return (
    <div className="space-y-6">
      <BillingNav active="muhasebe" />
      <PageHeader
        eyebrow="Finans"
        title="Muhasebe"
        description="Tahsilat, KDV, iade, gelir türü ve ödeme yöntemi özeti. Her kart ilgili fatura defterine gider."
        actions={
          <a
            href={`${ACCOUNTING_EXPORT_PATH}?${exportQs}`}
            className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink-950 hover:border-brand-400 hover:text-brand-600"
          >
            <Download className="h-3.5 w-3.5" /> Muhasebeci CSV (bu dönem)
          </a>
        }
      />

      <PeriodBar basePath="/admin/muhasebe" period={period} />

      {loadError ? (
        <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-warn-500/30 bg-warn-500/10 p-3 text-sm text-warn-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Fatura verisi okunamadı; rakamlar eksik olabilir. Sayfayı yenileyin; sürerse sistem sağlığına bakın.</p>
        </div>
      ) : null}
      {ledger.truncated ? (
        <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-warn-500/30 bg-warn-500/10 p-3 text-sm text-warn-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Bu dönem {LEDGER_MAX_ROWS.toLocaleString("tr-TR")} satır sınırını aştı; rakamlar eksik. Dönemi daraltın.</p>
        </div>
      ) : null}

      <section aria-labelledby="ozet-baslik" className="space-y-3">
        <h2 id="ozet-baslik" className="font-display font-bold text-ink-950">Dönem özeti · {period.label}</h2>
        <StatRow items={items} label="Muhasebe özeti" />
        <p className="text-xs text-text-faint">
          Tahsilat = durumu &quot;Ödendi&quot; ve ödeme tarihi dönemde olan faturalar; iade = iade kaydının tarihi dönemde olanlar.
          Bekleyen ve gecikmiş kartlar dönemden bağımsız, güncel durumdur (taslaklar borç sayılmaz).
        </p>
      </section>

      {comparison.length > 0 ? (
        <section aria-labelledby="karsilastirma-baslik" className="space-y-1">
          <h2 id="karsilastirma-baslik" className="font-display font-bold text-ink-950">Önceki dönemle karşılaştırma</h2>
          <ul>
            {comparison.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="focus-ring grid min-h-10 grid-cols-[1fr_auto_auto] items-center gap-4 rounded-[var(--radius-control)] px-1.5 text-sm tabular-nums transition-colors hover:bg-[var(--surface-sunken)]">
                  <span className="text-text">{c.label}</span>
                  <span className="text-xs text-text-faint">önceki {formatKurusShort(c.prev)}</span>
                  <span className="flex items-center justify-end gap-2">
                    <span className="font-semibold text-text">{formatKurusShort(c.cur)}</span>
                    <TrendPill trend={computeTrend(c.cur, c.prev, c.invert)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="abonelik-baslik" className="space-y-3">
        <h2 id="abonelik-baslik" className="font-display font-bold text-ink-950">Abonelik hareketi</h2>
        <StatRow items={subItems} label="Abonelik hareketi" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-4 font-display font-bold text-ink-950">Gelir türü kırılımı</h2>
          <RankedBars
            className="px-4 pt-3"
            format={formatKurusShort}
            emptyText="Bu dönemde gelir yok"
            rows={INVOICE_KINDS.map((k) => ({
              label: INVOICE_KIND_LABELS[k],
              value: summary.byKind[k].net,
              hint: `${summary.byKind[k].count} fatura`,
              href: defterHref(period, { durum: "paid", tur: k }),
            }))}
          />
          <BreakdownTable
            rows={INVOICE_KINDS.map((k) => ({
              key: k,
              label: INVOICE_KIND_LABELS[k],
              count: summary.byKind[k].count,
              net: summary.byKind[k].net,
              gross: summary.byKind[k].gross,
              href: defterHref(period, { durum: "paid", tur: k }),
            }))}
          />
        </section>
        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-4 font-display font-bold text-ink-950">Ödeme yöntemi kırılımı</h2>
          <RankedBars
            className="px-4 pt-3"
            format={formatKurusShort}
            emptyText="Bu dönemde tahsilat yok"
            rows={PAYMENT_METHOD_CODES.map((m) => ({
              label: PAYMENT_METHOD_LABELS[m],
              value: summary.byMethod[m].net,
              hint: `${summary.byMethod[m].count} fatura`,
              href: defterHref(period, { durum: "paid", yontem: m }),
            }))}
          />
          <BreakdownTable
            rows={PAYMENT_METHOD_CODES.map((m) => ({
              key: m,
              label: PAYMENT_METHOD_LABELS[m],
              count: summary.byMethod[m].count,
              net: summary.byMethod[m].net,
              gross: summary.byMethod[m].gross,
              href: defterHref(period, { durum: "paid", yontem: m }),
            }))}
          />
        </section>
      </div>

      <section aria-labelledby="ef-baslik" className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div>
          <h2 id="ef-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
            <FileSpreadsheet className="h-4 w-4 text-brand-600" /> EmlakFiyatı kontör geliri ve maliyeti
          </h2>
          <p className="mt-1 text-xs text-text-faint">
            Gelir: dönemde satılan kontör paketlerinin net tutarı. Maliyet: dönemde kesinleşen işlem sayısı × kardeş firma toptan tarifesi (KDV hariç).
            Satış ve kullanım aynı dönemde olmak zorunda değildir; marj dönem içi brüt göstergedir.
          </p>
        </div>

        <StatRow
          label="Kontör geliri"
          items={[
            {
              label: "Kontör satış geliri (net)",
              value: formatKurusShort(creditSoldNet),
              href: defterHref(period, { durum: "paid", tur: "credit_pack" }),
              hint: `${summary.byKind.credit_pack.count} paket faturası`,
            },
          ]}
        />

        {!efUsage.enabled ? (
          <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3 text-sm text-text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <p>Etkin değil: cüzdan hazır değil. Kontör kullanım kayıtları (ef_credit_reservations) oluşunca harcanan kontör, maliyet ve marj burada görünür.</p>
          </div>
        ) : (
          <>
            {efUsage.truncated ? (
              <p role="alert" className="text-xs font-semibold text-warn-600">Kullanım kaydı sınırı aşıldı; sayılar eksik. Dönemi daraltın.</p>
            ) : null}
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Harcanan kontör" value={econ.units.toLocaleString("tr-TR")} />
              <Metric label="İşlem sayısı" value={econ.transactions.toLocaleString("tr-TR")} />
              <Metric label="Toptan maliyet" value={formatKurus(econ.costKurus)} />
              <Metric label="Brüt marj" value={formatKurus(econ.marginKurus)} tone={econ.marginKurus < 0 ? "danger" : "default"} />
              <Metric
                label="Harcanan kontör başına ortalama gelir"
                value={econ.revenuePerSpentUnitKurus === null ? "—" : formatKurus(econ.revenuePerSpentUnitKurus)}
              />
            </dl>
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[32rem] text-left text-xs">
                <caption className="sr-only">Kontör kullanımı kalem bazında</caption>
                <THead className="text-text-faint">
                  <TR>
                    <TH scope="col" className="py-1.5 pr-3 font-semibold">Kalem</TH>
                    <TH scope="col" className="py-1.5 pr-3 text-right font-semibold">İşlem</TH>
                    <TH scope="col" className="py-1.5 pr-3 text-right font-semibold">Kontör</TH>
                    <TH scope="col" className="py-1.5 text-right font-semibold">Maliyet</TH>
                  </TR>
                </THead>
                <TBody className="divide-y divide-line">
                  {econ.byItem.map((r) => (
                    <TR key={r.item}>
                      <TH scope="row" className="py-1.5 pr-3 font-medium text-ink-950">{EF_ITEM_LABELS[r.item]}</TH>
                      <TD className="py-1.5 pr-3 text-right">{r.transactions.toLocaleString("tr-TR")}</TD>
                      <TD className="py-1.5 pr-3 text-right">{r.units.toLocaleString("tr-TR")}</TD>
                      <TD className="py-1.5 text-right">{formatKurus(r.costKurus)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {econ.unknownItems > 0 ? (
              <p className="text-xs text-warn-600">{econ.unknownItems} kayıt bilinmeyen kalemde olduğu için sayılmadı.</p>
            ) : null}
          </>
        )}

        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <p className="text-xs font-semibold text-ink-950">EmlakFiyatı toptan maliyet (işlem başı, KDV hariç)</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Geçerli: değerleme {formatKurus(Math.round(wholesale.valuationTl * 100))} · ilk PDF {formatKurus(Math.round(wholesale.pdfTl * 100))}.
            Varsayılan 0: EmlakFiyatı kullanım tarifesi 0 TL iken maliyet sıfır görünür.
          </p>
          {isSuper ? (
            <div className="mt-2">
              <InlineOp
                label="Maliyeti düzenle"
                confirmLabel="Kaydet"
                hidden={{}}
                action={saveEfWholesale}
                hint="Değişiklik denetim kaydına yazılır ve yalnız bundan sonraki hesapları etkiler (geçmiş dönem de bu tarifeyle yeniden hesaplanır)."
              >
                <label className="text-xs font-semibold text-text-muted">
                  Değerleme (₺)
                  <input name="valuation_tl" defaultValue={String(wholesale.valuationTl).replace(".", ",")} inputMode="decimal" className={`mt-1 block w-28 ${opFieldClass}`} />
                </label>
                <label className="text-xs font-semibold text-text-muted">
                  İlk PDF (₺)
                  <input name="pdf_tl" defaultValue={String(wholesale.pdfTl).replace(".", ",")} inputMode="decimal" className={`mt-1 block w-28 ${opFieldClass}`} />
                </label>
              </InlineOp>
            </div>
          ) : (
            <p className="mt-2 text-xs text-text-faint">Düzenleme yalnız süper admin içindir.</p>
          )}
        </div>

        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-3 text-xs text-text-muted">
          <p className="font-semibold text-ink-950">Mutabakat</p>
          <p className="mt-0.5">EmlakFiyatı aylık dökümüyle eşleştirme: ortak adaptör hazır olunca.</p>
        </div>
      </section>

      <section id="hesap-kredisi" aria-labelledby="hk-baslik" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div>
          <h2 id="hk-baslik" className="font-display font-bold text-ink-950">Kullanılmamış hesap kredisi (yükümlülük)</h2>
          <p className="mt-1 text-xs text-text-faint">
            Salt okunur: ofislerin TL kredi defterindeki nominal bakiyesi (eksi bakiyeler sayılmaz; vadesi dolup defterde düşülmemiş tutar dahil olabilir, yani üst sınırdır).
            Güncel durumdur, dönemden bağımsızdır.
          </p>
        </div>
        {!tryLiability ? (
          <p className="text-sm text-text-muted">Kredi defteri okunamadı ya da henüz etkin değil.</p>
        ) : tryLiability.top.length === 0 ? (
          <p className="text-sm text-text-muted">Kullanılmamış hesap kredisi yok.</p>
        ) : (
          <>
            {tryLiability.truncated ? (
              <p role="alert" className="text-xs font-semibold text-warn-600">Defter satır sınırı aşıldı; toplam eksik olabilir.</p>
            ) : null}
            <ul className="divide-y divide-line text-sm">
              {tryLiability.top.map((r) => (
                <li key={r.tenantId} className="flex items-center justify-between gap-3 py-1.5">
                  <Link href={`/admin/tenants/${r.tenantId}`} className="focus-ring font-medium text-ink-950 hover:text-brand-600">{r.name}</Link>
                  <span className="numeric font-semibold text-ink-950">{formatKurus(r.kurus)}</span>
                </li>
              ))}
            </ul>
            {tryLiability.tenantCount > tryLiability.top.length ? (
              <p className="text-xs text-text-faint">En yüksek {tryLiability.top.length} ofis gösteriliyor ({tryLiability.tenantCount} ofiste bakiye var).</p>
            ) : null}
          </>
        )}
      </section>

      <p className="text-xs text-text-faint">
        <Link href="/admin/muhasebe/defter" className="focus-ring font-semibold text-brand-600 hover:underline">Fatura defteri</Link>
        {" · "}e-Fatura entegrasyonu bu ekranda yoktur (ayrı iş).
      </p>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className={`mt-0.5 font-display text-lg font-extrabold ${tone === "danger" ? "text-danger-600" : "text-ink-950"}`}>{value}</dd>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: { key: string; label: string; count: number; net: number; gross: number; href: string }[] }) {
  return (
    <div className="overflow-x-auto px-5 py-3">
      <Table className="w-full min-w-[22rem] text-left text-xs">
        <THead className="text-text-faint">
          <TR>
            <TH scope="col" className="py-1.5 pr-3 font-semibold">Kalem</TH>
            <TH scope="col" className="py-1.5 pr-3 text-right font-semibold">Adet</TH>
            <TH scope="col" className="py-1.5 pr-3 text-right font-semibold">Net</TH>
            <TH scope="col" className="py-1.5 text-right font-semibold">Brüt</TH>
          </TR>
        </THead>
        <TBody className="divide-y divide-line">
          {rows.map((r) => (
            <TR key={r.key} className={r.count === 0 ? "opacity-60" : undefined}>
              <TH scope="row" className="py-1.5 pr-3 font-medium">
                <Link href={r.href} className="focus-ring text-ink-950 hover:text-brand-600">{r.label}</Link>
              </TH>
              <TD className="py-1.5 pr-3 text-right">{r.count.toLocaleString("tr-TR")}</TD>
              <TD className="py-1.5 pr-3 text-right">{formatKurus(r.net)}</TD>
              <TD className="py-1.5 text-right font-semibold text-ink-950">{formatKurus(r.gross)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
