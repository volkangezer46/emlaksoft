import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowDownCircle, ArrowUpCircle, ArrowUpRight, BarChart3, FileSpreadsheet, HandCoins, Radio, Scale, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { createClient } from "@/lib/supabase/server";
import { now, trMonthKey } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { CASH_CATEGORIES } from "@/lib/finance/cash/categories";
import { addMonths, monthBounds, pnlCashMonths, sumCategoryRecords, type PnlRaw } from "@/lib/finance/expense-budget";
import { reportCenterHref } from "@/lib/report-center/links";
import { CategoryBars } from "../category-bars";
import { FINANCE_PATH, categoryLabelMap, loadCustomCategories, monthLabelOf, type FinanceTabProps } from "./butce";

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
 * Raporlar sekmesi (?sekme=raporlar&donem=6|12|24): aylık kâr/zarar (finance_pnl), kategori kırılımı, danışman ve portal
 * kârlılığı kartları ve rapor merkezi bağlantıları. Ofisin toplam kazancı yalnız `earnings_all` sahibine gösterilir.
 */
export async function RaporlarTab({ params, perms, isOwnerGm }: FinanceTabProps) {
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
    const [pnlRes, defs, custom] = await Promise.all([
      supabase.rpc("finance_pnl", { p_from: from, p_to: to }),
      getDefinitionsOrDefault("expense_category"),
      loadCustomCategories(supabase),
    ]);
    if (pnlRes.error) {
      body = isMissingCashSchema(pnlRes.error) ? (
        <Alert tone="info" title="Kâr/zarar özeti kurulum bekliyor">
          Elle girilen gelirleri de sayan yeni kâr/zarar muhasebe güncellemesiyle açılır. O zamana kadar{" "}
          <Link href="/app/raporlar/kar-zarar" className="font-semibold underline">Kâr / zarar raporu</Link> çalışmaya devam eder.
        </Alert>
      ) : (
        <Alert tone="warning">Kâr/zarar şu an yüklenemedi; sayfayı yenileyin.</Alert>
      );
    } else {
      const months = pnlCashMonths((pnlRes.data ?? []) as PnlRaw[]);
      const labels = categoryLabelMap(defs, custom.rows);
      body = <PnlSection months={months} labelOf={(k) => labels.get(k) ?? k} from={from} to={to} period={period} />;
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

      <section aria-label="Kârlılık" className="grid gap-3 sm:grid-cols-3">
        {seeEarnings ? (
          <InsightLink
            href="/app/raporlar/kar-zarar"
            icon={<Scale className="h-5 w-5" aria-hidden="true" />}
            title="Kâr / zarar ayrıntısı"
            text="Komisyon, KDV, dağıtılan paylar, yönetim ücreti, elle girilen gelir ve gider; ay ay net sonuç."
          />
        ) : null}
        {isOwnerGm && seeEarnings ? (
          <InsightLink
            href="/app/raporlar/kar-zarar#danisman-karliligi"
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
            title="Danışman kârlılığı"
            text="Danışman başına ofiste kalan komisyon ↔ portföylerine bağlı doğrudan giderler."
          />
        ) : null}
        <InsightLink
          href={`${FINANCE_PATH}?sekme=butce#portal-getirisi`}
          icon={<Radio className="h-5 w-5" aria-hidden="true" />}
          title="Portal kârlılığı"
          text="Portal başına gider payı ↔ gelen talep ve kazanılan anlaşma; talep ve anlaşma başına maliyet."
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

function PnlSection({
  months,
  labelOf,
  from,
  to,
  period,
}: {
  months: ReturnType<typeof pnlCashMonths>;
  labelOf: (k: string) => string;
  from: string;
  to: string;
  period: number;
}) {
  const income = months.reduce((s, m) => s + m.income, 0);
  const expense = months.reduce((s, m) => s + m.expense, 0);
  const manual = months.reduce((s, m) => s + m.manualIncome, 0);
  const net = income - expense;
  const entries = (f: string, t: string, extra = "") => `${FINANCE_PATH}?sekme=hareketler&from=${f}&to=${t}${extra}`;
  const kpis: KpiItem[] = [
    { label: "Gelir", value: formatTry(income), icon: <ArrowDownCircle />, tone: "success", href: entries(from, to, "&tur=gelir"), hint: `son ${period} ay`, series: months.map((m) => m.income) },
    { label: "Gider", value: formatTry(expense), icon: <ArrowUpCircle />, tone: "warning", href: entries(from, to, "&tur=gider"), hint: `son ${period} ay`, series: months.map((m) => m.expense) },
    { label: "Net", value: formatTry(net), icon: <Scale />, tone: net < 0 ? "danger" : "info", href: "/app/raporlar/kar-zarar", hint: "gelir − gider", attention: net < 0 },
    { label: "Elle girilen gelir", value: formatTry(manual), icon: <HandCoins />, tone: "neutral", href: entries(from, to, "&tur=gelir"), hint: "hizmet bedeli, diğer gelir…" },
  ];
  if (months.length === 0 || (income === 0 && expense === 0)) {
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
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
  const incomeCats = sumCategoryRecords(months.map((m) => m.incomeByCategory));
  const expenseCats = sumCategoryRecords(months.map((m) => m.expenseByCategory));
  const catHref = (dir: "gelir" | "gider") => (v: string | null) => (v && CASH_KEYS.has(v) ? entries(from, to, `&tur=${dir}&kategori=${encodeURIComponent(v)}`) : entries(from, to, `&tur=${dir}`));

  return (
    <>
      <KpiStrip items={kpis} label="Kâr/zarar özeti" />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Aylık gelir ve gider</CardTitle>
            <CardDescription>Aya tıklayınca o ayın hareketleri açılır. Komisyon tahakkuk ayında; elle girilen gelir hareket tarihinde sayılır.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="flex h-48 items-end gap-1.5 overflow-x-auto pb-1" aria-label="Aylık gelir ve gider çubukları">
            {months.map((m) => {
              const b = monthBounds(m.key);
              const mNet = m.income - m.expense;
              return (
                <li key={m.key} className="flex h-full min-w-[2.25rem] flex-1 flex-col">
                  <Link
                    href={entries(b.from, b.to)}
                    title={`${monthLabelOf(m.key)} · gelir ${formatTry(m.income)} · gider ${formatTry(m.expense)} · net ${formatTry(mNet)}`}
                    className="focus-ring group flex h-full flex-col justify-end rounded-[var(--radius-control)] px-0.5 hover:bg-surface-hover"
                  >
                    <span className="flex flex-1 items-end justify-center gap-0.5">
                      <span
                        className="block w-2.5 rounded-t-sm bg-mint-500 sm:w-3"
                        style={{ height: `${Math.round((m.income / max) * 100)}%` }}
                        aria-hidden="true"
                      />
                      <span
                        className="block w-2.5 rounded-t-sm bg-danger-500 opacity-80 sm:w-3"
                        style={{ height: `${Math.round((m.expense / max) * 100)}%` }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-1 block text-center text-xs capitalize text-text-faint group-hover:text-text">{SHORT_MONTH.format(new Date(`${m.key}-01T00:00:00Z`))}</span>
                    <span className="sr-only">
                      {monthLabelOf(m.key)}: gelir {formatTry(m.income)}, gider {formatTry(m.expense)}, net {formatTry(mNet)}
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
    </>
  );
}
