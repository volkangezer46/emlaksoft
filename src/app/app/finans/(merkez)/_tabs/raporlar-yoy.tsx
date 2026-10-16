import { financePath } from "@/lib/finance/routes";
import Link from "@/components/ui/smart-link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarCompare } from "@/components/ui/viz/server-charts";
import { DonutBreakdown } from "@/components/ui/viz";
import { formatTry } from "@/lib/format";
import { loadPnl } from "@/lib/finance/ledger/load";
import { incomeSourceMix, shiftMonth, yearOverYear, type YoyTotals } from "@/lib/finance/profitability";
import { monthRange } from "./insight-links";
import { cn } from "@/lib/utils";

/**
 * Raporlar > "Geçen yılla karşılaştırma" ve "Gelir kaynakları" (kendi Suspense sınırında akar; yalnız tüm kazancı görebilen
 * yöneticiye çizilir). Tek toplama RPC'si: `finance_pnl` son 24 ay, tahakkuk esası (gelir = brüt komisyon + yönetim ücreti +
 * elle girilen gelir; gider = ofis giderleri + danışman/dış taraf payları). Hesap SAF `@/lib/finance/profitability`. Her sayı ilgili aya/kategoriye gider.
 */

const SHORT_MONTH = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const shortMonth = (key: string) => `${SHORT_MONTH[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

const SOURCE_LABEL: Record<string, string> = {
  komisyon: "Komisyon (brüt)",
  kira_yonetimi: "Yönetim ücreti",
  diger_gelir: "Kategorisiz gelir",
  __diger: "Diğer kaynaklar",
};

function sourceHref(key: string, from: string, to: string): string {
  if (key === "komisyon") return `${financePath("komisyon")}?from=${from}&to=${to}`;
  if (key === "kira_yonetimi") return "/app/kiralama?yonetim=ucret";
  if (key === "__diger" || key === "diger_gelir" || !/^[a-z0-9_]{1,60}$/.test(key)) return `${financePath("hareketler")}?tur=gelir&kaynak=elle&from=${from}&to=${to}`;
  return `${financePath("hareketler")}?tur=gelir&kategori=${encodeURIComponent(key)}&from=${from}&to=${to}`;
}

function Change({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-xs text-text-faint">geçen yıl veri yok</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", value === 0 ? "text-text-muted" : good ? "text-success-strong" : "text-danger-strong")}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />%{Math.abs(value).toLocaleString("tr-TR")}
      <span className="sr-only">{value >= 0 ? " artış" : " azalış"}</span>
    </span>
  );
}

export async function YoyCard({ current, labelOf }: { current: string; labelOf: (k: string) => string }) {
  const first = shiftMonth(current, -23);
  const rows = await loadPnl(`${first}-01`, monthRange(current).to);
  if (rows.length === 0) return null;
  const yoy = yearOverYear(rows, current, 12);
  const last12From = `${shiftMonth(current, -11)}-01`;
  const to = monthRange(current).to;
  const mix = incomeSourceMix(rows.filter((r) => r.month.slice(0, 7) >= shiftMonth(current, -11)), { top: 5 });
  const anyCurrent = yoy.months.some((m) => m.income !== 0 || m.expense !== 0);
  if (!anyCurrent && mix.length === 0) return null;

  const year = current.slice(0, 4);
  const ytdHref = `${financePath("hareketler")}?from=${year}-01-01&to=${to}`;
  const prevYtdHref = `${financePath("hareketler")}?from=${Number(year) - 1}-01-01&to=${monthRange(shiftMonth(current, -12)).to}`;
  const tiles: { label: string; key: keyof YoyTotals; prevKey: keyof YoyTotals; changeKey: "incomeChange" | "netChange" | null; invert?: boolean }[] = [
    { label: "Gelir", key: "income", prevKey: "prevIncome", changeKey: "incomeChange" },
    { label: "Gider", key: "expense", prevKey: "prevExpense", changeKey: null, invert: true },
    { label: "Net", key: "net", prevKey: "prevNet", changeKey: "netChange" },
  ];
  const expenseChange = yoy.ytd.prevExpense === 0 ? null : Math.round(((yoy.ytd.expense - yoy.ytd.prevExpense) / Math.abs(yoy.ytd.prevExpense)) * 1000) / 10;

  const chart = yoy.months.map((m) => {
    const b = monthRange(m.key);
    return { ay: shortMonth(m.key), bu: m.net, gecen: m.prevNet, href: `${financePath("hareketler")}?from=${b.from}&to=${b.to}` };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Geçen yılla karşılaştırma</CardTitle>
            <CardDescription>
              Yılbaşından bugüne ({year}) ↔ geçen yılın aynı dönemi. Bu ay devam ediyor; geçen yılın aynı ayı tam sayılır.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {tiles.map((t) => {
              const cur = yoy.ytd[t.key] as number;
              const prev = yoy.ytd[t.prevKey] as number;
              const change = t.changeKey ? yoy.ytd[t.changeKey] : expenseChange;
              return (
                <div key={t.label} className="rounded-[var(--radius-card)] border border-line p-3">
                  <dt className="text-xs font-semibold text-text-muted">{t.label}</dt>
                  <dd className="mt-1 grid gap-0.5">
                    <Link href={ytdHref} className={cn("numeric font-display text-lg font-bold hover:underline", t.key === "net" && cur < 0 ? "text-danger-strong" : "text-text")}>
                      {formatTry(cur)}
                    </Link>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                      <Change value={change} invert={t.invert} />
                      <Link href={prevYtdHref} className="hover:underline">
                        geçen yıl {formatTry(prev)}
                      </Link>
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          {yoy.hasPrevYear ? (
            <div className="h-[240px]">
              <BarCompare
                data={chart}
                xKey="ay"
                series={[
                  { key: "bu", label: "Bu yıl net", color: "var(--viz-1)" },
                  { key: "gecen", label: "Geçen yıl net", color: "var(--viz-8)" },
                ]}
                format="money"
                hrefKey="href"
                ariaLabel="Son 12 ayın neti ve geçen yılın aynı ayları"
              />
            </div>
          ) : (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3 py-6 text-center text-xs text-text-muted">
              Geçen yılın aynı dönemine ait kayıt yok; karşılaştırma ilk tam yılınızdan sonra oluşur.
            </p>
          )}
        </CardContent>
      </Card>

      {mix.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Gelir kaynakları</CardTitle>
              <CardDescription>Son 12 ay · gelirin kaynaklara dağılımı (komisyon brüt; danışman payları giderdedir)</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DonutBreakdown
              ariaLabel="Gelir kaynakları dağılımı"
              items={mix.map((m, i) => ({
                key: m.key,
                label: SOURCE_LABEL[m.key] ?? labelOf(m.key),
                value: m.total,
                href: sourceHref(m.key, last12From, to),
                title: formatTry(m.total),
                tone: i === 0 ? "brand" : undefined,
              }))}
              center={
                <span className="grid text-center">
                  <span className="text-xs text-text-muted">en büyük</span>
                  <span className="numeric font-display text-base font-bold text-text">%{mix[0]!.share.toLocaleString("tr-TR")}</span>
                </span>
              }
            />
            {mix[0]!.share >= 80 ? (
              <p className="mt-3 text-xs text-warning-strong">
                Gelirinizin %{mix[0]!.share.toLocaleString("tr-TR")}&apos;i tek kaynaktan geliyor. Yönetim ücreti ya da hizmet bedeli gibi düzenli gelirler riski azaltır.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
