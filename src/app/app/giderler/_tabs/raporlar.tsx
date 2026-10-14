import { Suspense, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowDownCircle, ArrowUpCircle, ArrowUpRight, BarChart3, FileSpreadsheet, HandCoins, Radio, Scale, Share2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { createClient } from "@/lib/supabase/server";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SkeletonCard } from "@/components/ui/viz";
import { now, trMonthKey } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { CASH_CATEGORIES } from "@/lib/finance/cash/categories";
import { addMonths, monthBounds, sumCategoryRecords, type PnlCashMonth } from "@/lib/finance/expense-budget";
import { loadOfficeProfitData } from "@/lib/finance/office-profit-data";
import { computeOfficePnl, lastMonthKeys, type OfficePnl } from "@/lib/reporting/profit-loss";
import { reportCenterHref } from "@/lib/report-center/links";
import { CategoryBars } from "../category-bars";
import { FINANCE_PATH, categoryLabelMap, loadCustomCategories, monthLabelOf, type FinanceTabProps } from "./butce";
import { AdvisorProfitCard } from "./advisor-profit";

const PERIODS = [6, 12, 24] as const;
const SHORT_MONTH = new Intl.DateTimeFormat("tr-TR", { month: "short", timeZone: "UTC" });

/** Rapor merkezindeki finans raporları (dışa aktarma YALNIZ orada; sekmede indirme düğmesi yok). */
const REPORT_LINKS: readonly { id: string; title: string; description: string; earnings?: boolean }[] = [
  { id: "muhasebeci-paketi", title: "Muhasebeci paketi", description: "Defter, cari bakiyeler, KDV ve açık kalemler tek dosyada" },
  { id: "kdv-ozeti", title: "KDV özeti", description: "Aylık hesaplanan, indirilecek, ödenecek KDV ve stopaj" },
  { id: "cari-ekstresi", title: "Cari ekstresi", description: "Kişi ve firma bazında borç, alacak ve yürüyen bakiye" },
  { id: "acik-kalemler", title: "Açık kalemler", description: "Vadeli alacak ve borçlar, kalan tutar ve gecikme" },
  { id: "nakit-akis-tahmini", title: "Nakit akışı tahmini", description: "Önümüzdeki 30/90 gün günlük giriş, çıkış ve bakiye" },
  { id: "butce-gerceklesen", title: "Bütçe ↔ gerçekleşen", description: "Aylık gelir hedefi ve gider bütçesi karşılaştırması" },
  { id: "gelir-gider-dokumu", title: "Gelir-gider dökümü", description: "Hesaplara işlenen gelir ve giderlerin dökümü" },
  { id: "hesap-ekstresi", title: "Hesap ekstresi", description: "Kasa ve banka hesaplarının hareket dökümü" },
  { id: "kar-zarar", title: "Kâr / zarar (aylık)", description: "Komisyon, elle girilen gelir, paylar, gider ve net", earnings: true },
];

/**
 * Raporlar sekmesi (?sekme=raporlar&donem=6|12|24): ofisin TEK kâr/zarar ekranı. Aylık net, komisyon/diğer gelir/KDV/pay/gider
 * kırılımı (hesap TEK fonksiyon: `computeOfficePnl`), kategori kırılımı (finance_pnl), danışman ve portal kârlılığı ve rapor
 * merkezi bağlantıları. Ofisin toplam kazancı yalnız `earnings_all` sahibine; danışman kırılımı yalnız ofis sahibi / GM'ye.
 */
export async function RaporlarTab({ params, perms, isOwnerGm, tenantId, userId }: FinanceTabProps) {
  const seeEarnings = canSeeAllEarnings(perms);
  const periodRaw = Number(params.donem);
  const period = (PERIODS as readonly number[]).includes(periodRaw) ? periodRaw : 12;
  const current = trMonthKey(now());
  const firstKey = addMonths(current, -(period - 1));
  const from = `${firstKey}-01`;
  const to = monthBounds(current).to;
  const reports = REPORT_LINKS.filter((r) => !r.earnings || seeEarnings);

  let body: ReactNode = null;
  if (!seeEarnings) {
    body = (
      <Alert tone="info" title="Kâr/zarar yalnız yöneticilere açık">
        Aylık kâr/zarar ofisin toplam kazancını gösterdiği için yalnız tüm kazancı görme yetkisi olan yöneticilere açılır. Aşağıdaki raporları kullanabilirsiniz.
      </Alert>
    );
  } else {
    const supabase = await createClient();
    // Komisyon + paylar + giderler + defter eki TEK ortak okuma (kısa TTL'li ofis önbelleği; danışman kartıyla paylaşılır).
    const [data, defs, custom] = await Promise.all([
      loadOfficeProfitData(tenantId, userId, firstKey).catch(() => null),
      getDefinitionsOrDefault("expense_category"),
      loadCustomCategories(supabase),
    ]);
    if (!data) {
      body = <Alert tone="warning">Kâr/zarar şu an yüklenemedi; sayfayı yenileyin.</Alert>;
    } else {
      const keys = lastMonthKeys(current, period);
      const pl = computeOfficePnl(keys, {
        commissions: data.commissions,
        splits: data.splits,
        expenses: data.expenses,
        fees: data.fees,
        cash: data.cashPnl ?? null,
      });
      const labels = categoryLabelMap(defs, custom.rows);
      body = (
        <>
          <PnlSection pl={pl} cash={data.cashPnl ?? null} labelOf={(k) => labels.get(k) ?? k} from={from} to={to} period={period} />
          {isOwnerGm && pl.hasData ? (
            <Suspense fallback={<SkeletonCard height={320} label="Danışman kârlılığı yükleniyor" />}>
              <AdvisorProfitCard tenantId={tenantId} userId={userId} firstMonthKey={firstKey} />
            </Suspense>
          ) : null}
        </>
      );
    }
  }

  const tabHref = (p: number) => `${FINANCE_PATH}?sekme=raporlar${p === 12 ? "" : `&donem=${p}`}`;

  return (
    <div className="grid gap-5">
      {seeEarnings ? (
        <nav aria-label="Rapor dönemi" className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <FilterChip key={p} href={tabHref(p)} active={p === period}>
              Son {p} ay
            </FilterChip>
          ))}
        </nav>
      ) : null}

      {body}

      <section aria-label="Kârlılık" className="grid gap-3 sm:grid-cols-2">
        <InsightLink
          href={`${FINANCE_PATH}?sekme=butce#portal-getirisi`}
          icon={<Radio className="h-5 w-5" aria-hidden="true" />}
          title="Portal kârlılığı"
          text="Portal başına gider payı ↔ gelen talep ve kazanılan anlaşma; talep ve anlaşma başına maliyet."
        />
        <InsightLink
          href="/app/komisyon"
          icon={<Share2 className="h-5 w-5" aria-hidden="true" />}
          title="Komisyon ve paylar"
          text="Komisyon defteri, danışman payları ve tahsilat; kâr/zarardaki komisyon ve pay rakamlarının kaynağı."
        />
      </section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-brand-600" aria-hidden /> Rapor merkezi</CardTitle>
            <CardDescription>Excel, PDF ve CSV çıktıları yalnız rapor merkezinden alınır; her rapor ofisinize ve yetkinize göre süzülür.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {reports.map((r) => (
              <li key={r.id}>
                <Link
                  href={reportCenterHref("tenant", r.id, r.id === "kar-zarar" ? {} : { from, to })}
                  className="focus-ring press lift group flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 transition hover:border-brand-300"
                >
                  <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-text-faint group-hover:text-accent-text" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-sm font-semibold text-text">
                      {r.title}
                      <ArrowUpRight className="h-3 w-3 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">{r.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function InsightLink({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link href={href} className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] transition hover:border-brand-300">
      <span className="flex items-center justify-between gap-2 text-accent-text">
        {icon}
        <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
      </span>
      <span className="mt-2 block font-display text-sm font-bold text-text">{title}</span>
      <span className="mt-1 block text-xs text-text-muted">{text}</span>
    </Link>
  );
}

const CASH_KEYS = new Set(CASH_CATEGORIES.map((c) => c.value));

const MONTH_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const monthLabel = (key: string) => `${MONTH_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function PnlSection({
  pl,
  cash,
  labelOf,
  from,
  to,
  period,
}: {
  pl: OfficePnl;
  cash: readonly PnlCashMonth[] | null;
  labelOf: (k: string) => string;
  from: string;
  to: string;
  period: number;
}) {
  const t = pl.totals;
  const entries = (f: string, tt: string, extra = "") => `${FINANCE_PATH}?sekme=hareketler&from=${f}&to=${tt}${extra}`;
  /** Ofise kalan gelir (aylık çubuk): komisyon − KDV − dış paylar + yönetim ücreti + elle girilen gelir. */
  const incomeOf = (m: OfficePnl["months"][number]) => m.revenue - m.vat - m.shares + m.fees + m.other;
  const kpis: KpiItem[] = [
    { label: "Komisyon (brüt)", value: formatTry(t.revenue), icon: <ArrowDownCircle />, tone: "success", href: `/app/komisyon?from=${from}`, hint: `${t.commissions} kayıt · son ${period} ay`, series: pl.months.map((m) => m.revenue) },
    { label: "Diğer gelir (elle)", value: formatTry(t.other), icon: <HandCoins />, tone: "neutral", href: entries(from, to, "&tur=gelir&kaynak=elle"), hint: "hizmet bedeli, diğer gelir" },
    { label: "KDV ve dağıtılan paylar", value: formatTry(t.vat + t.shares), icon: <Share2 />, tone: "neutral", href: `/app/komisyon?from=${from}`, hint: `KDV ${formatTry(t.vat)} · paylar ${formatTry(t.shares)}` },
    { label: "Gider", value: formatTry(t.expenses), icon: <ArrowUpCircle />, tone: "warning", href: entries(from, to, "&tur=gider"), hint: `son ${period} ay`, series: pl.months.map((m) => m.expenses) },
    { label: "Net", value: formatTry(t.net), icon: <Scale />, tone: t.net < 0 ? "danger" : "info", href: "#aylik-kar-zarar", hint: "aylık tablo", attention: t.net < 0 },
  ];
  if (!pl.hasData) {
    return (
      <EmptyState
        icon={BarChart3}
        title={`Son ${period} ayda gelir ya da gider yok`}
        description="Komisyon kayıtları, elle girilen gelirler ve giderler geldikçe aylık kâr/zarar burada oluşur."
        tone="brand"
        variant="compact"
      />
    );
  }
  const max = Math.max(1, ...pl.months.map((m) => Math.max(Math.abs(incomeOf(m)), m.expenses)));
  const incomeCats = cash ? sumCategoryRecords(cash.map((m) => m.incomeByCategory)) : [];
  const expenseCats = cash ? sumCategoryRecords(cash.map((m) => m.expenseByCategory)) : [];
  const catHref = (dir: "gelir" | "gider") => (v: string | null) => (v && CASH_KEYS.has(v) ? entries(from, to, `&tur=${dir}&kategori=${encodeURIComponent(v)}`) : entries(from, to, `&tur=${dir}`));

  return (
    <>
      <KpiStrip items={kpis} label="Kâr/zarar özeti" />
      {pl.unsplitCount > 0 ? (
        <Alert tone="warning">
          {pl.unsplitCount} komisyon kaydında paylaşım tanımlanmamış: bu kayıtların danışman payı düşülmedi, net olduğundan yüksek görünebilir.{" "}
          <Link href="/app/komisyon" className="font-semibold underline">Komisyon merkezi</Link>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aylık gelir ve gider</CardTitle>
            <CardDescription>Aya tıklayınca o ayın hareketleri açılır. Gelir = ofise kalan komisyon (KDV ve dış paylar düşülmüş), yönetim ücreti ve elle girilen gelir.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="flex h-48 items-end gap-1.5 overflow-x-auto pb-1" aria-label="Aylık gelir ve gider çubukları">
            {pl.months.map((m) => {
              const b = monthBounds(m.key);
              const inc = incomeOf(m);
              return (
                <li key={m.key} className="flex h-full min-w-[2.25rem] flex-1 flex-col">
                  <Link
                    href={entries(b.from, b.to)}
                    title={`${monthLabelOf(m.key)} · gelir ${formatTry(inc)} · gider ${formatTry(m.expenses)} · net ${formatTry(m.net)}`}
                    className="focus-ring group flex h-full flex-col justify-end rounded-[var(--radius-control)] px-0.5 hover:bg-surface-hover"
                  >
                    <span className="flex flex-1 items-end justify-center gap-0.5">
                      <span className="block w-2.5 rounded-t-sm bg-mint-500 sm:w-3" style={{ height: `${Math.round((Math.max(0, inc) / max) * 100)}%` }} aria-hidden="true" />
                      <span className="block w-2.5 rounded-t-sm bg-danger-500 opacity-80 sm:w-3" style={{ height: `${Math.round((m.expenses / max) * 100)}%` }} aria-hidden="true" />
                    </span>
                    <span className="mt-1 block text-center text-xs capitalize text-text-faint group-hover:text-text">{SHORT_MONTH.format(new Date(`${m.key}-01T00:00:00Z`))}</span>
                    <span className="sr-only">
                      {monthLabelOf(m.key)}: gelir {formatTry(inc)}, gider {formatTry(m.expenses)}, net {formatTry(m.net)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-mint-500" aria-hidden="true" /> Gelir</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger-500" aria-hidden="true" /> Gider</span>
            <span>Komisyon ve kira tahsilatı iki kez sayılmaz; transfer ve mülk sahibine ödeme gider değildir.</span>
          </p>
        </CardContent>
      </Card>

      <Card id="aylik-kar-zarar" className="scroll-mt-24">
        <CardHeader>
          <div>
            <CardTitle>Aylık kâr / zarar</CardTitle>
            <CardDescription>Komisyon (tahakkuk) ve elle girilen gelirden KDV, danışman ve diğer dış paylar ile ofis giderleri düşülünce kalan net.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <TableFrame stack minWidth={640}>
            <Table>
              <THead>
                <TR>
                  <TH>Ay</TH>
                  <TH align="right">Komisyon</TH>
                  {t.fees > 0 ? <TH align="right">Yönetim ücreti</TH> : null}
                  {t.other > 0 ? <TH align="right">Diğer gelir</TH> : null}
                  <TH align="right">KDV</TH>
                  <TH align="right">Paylar</TH>
                  <TH align="right">Gider</TH>
                  <TH align="right">Net</TH>
                </TR>
              </THead>
              <TBody>
                {[...pl.months].reverse().map((m) => {
                  const r = monthBounds(m.key);
                  return (
                    <TR key={m.key}>
                      <TD primary className="font-medium">{monthLabel(m.key)}</TD>
                      <TD label="Komisyon" align="right" className="numeric">
                        <Link href={`/app/komisyon?from=${r.from}&to=${r.to}`} className="hover:underline">{formatTry(m.revenue)}</Link>
                      </TD>
                      {t.fees > 0 ? (
                        <TD label="Yönetim ücreti" align="right" className="numeric">
                          <Link href="/app/kiralama?yonetim=ucret" className="hover:underline">{formatTry(m.fees)}</Link>
                        </TD>
                      ) : null}
                      {t.other > 0 ? (
                        <TD label="Diğer gelir" align="right" className="numeric">
                          <Link href={entries(r.from, r.to, "&tur=gelir&kaynak=elle")} className="hover:underline">{formatTry(m.other)}</Link>
                        </TD>
                      ) : null}
                      <TD label="KDV" align="right" className="numeric">
                        <Link href={`/app/komisyon?from=${r.from}&to=${r.to}`} className="hover:underline">{formatTry(m.vat)}</Link>
                      </TD>
                      <TD label="Paylar" align="right" className="numeric">
                        <Link href={`/app/komisyon?from=${r.from}&to=${r.to}`} className="hover:underline">{formatTry(m.shares)}</Link>
                      </TD>
                      <TD label="Gider" align="right" className="numeric">
                        <Link href={entries(r.from, r.to, "&tur=gider")} className="hover:underline">{formatTry(m.expenses)}</Link>
                      </TD>
                      <TD label="Net" align="right" className={`numeric font-semibold ${m.net < 0 ? "text-danger-600" : ""}`}>
                        <Link href={entries(r.from, r.to)} className="hover:underline">{formatTry(m.net)}</Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableFrame>
          <p className="text-xs leading-relaxed text-text-faint">
            Komisyon tahakkuk esasına göre (kayıt ayı) sayılır; tahsilat değildir. İptal edilen komisyon ve örnek veri hariç. &quot;Paylar&quot; ofis dışına giden
            danışman/referans/franchise paylarıdır. Yönetim ücreti, mülk yönetimindeki kira tahsilatlarından ofise kalan ücrettir; mülk sahibine yansıtılan gider ofis
            gideri sayılmaz.{pl.cashLinked ? " Diğer gelir: Muhasebe'de elle girilen gelir hareketleridir; gider, gidere dönüşmemiş kasa çıkışlarını (maaş vb.) da içerir." : ""} Gelir/kurumlar
            vergisi hesaplanmaz; mali müşavirinizle doğrulayın.
          </p>
        </CardContent>
      </Card>

      {cash ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Gelir kırılımı</CardTitle>
                <CardDescription>Son {period} ay · kategoriye tıklayınca hareketler süzülür</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {incomeCats.length === 0 ? (
                <p className="text-sm text-text-muted">Bu dönemde gelir yok.</p>
              ) : (
                <CategoryBars items={incomeCats.map((c) => ({ value: c.category, label: labelOf(c.category), total: c.total }))} activeValue="" hrefFor={catHref("gelir")} formatMoney={formatTry} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Gider kırılımı</CardTitle>
                <CardDescription>Son {period} ay · kategoriye tıklayınca hareketler süzülür</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {expenseCats.length === 0 ? (
                <p className="text-sm text-text-muted">Bu dönemde gider yok.</p>
              ) : (
                <CategoryBars items={expenseCats.map((c) => ({ value: c.category, label: labelOf(c.category), total: c.total }))} activeValue="" hrefFor={catHref("gider")} formatMoney={formatTry} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
