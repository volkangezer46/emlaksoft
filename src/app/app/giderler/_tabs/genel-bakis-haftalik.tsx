import Link from "@/components/ui/smart-link";
import { BarCompare } from "@/components/ui/viz/server-charts";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { shortDayTr, type ForecastWeek } from "@/lib/finance/forecast";
import { cn } from "@/lib/utils";

/**
 * 13 haftalık nakit akışı (Genel bakış, `?gun=91`): her hafta tahmini giriş ↔ çıkış sütunları ve hafta sonu bakiyesi.
 * Haftalar `weeklyForecast` (SAF, `@/lib/finance/forecast`) ile hesaplanır; sütun ve satırlar vadesi gelmemiş açık
 * kalemlere (Cari) gider. Eşiğin altına inen hafta kırmızı işaretlenir. Sunucu grafiği (istemci JS'i yok).
 */

const money = (n: number) => formatAccountMoney(n, "TRY");

export function WeeklyForecast({ weeks, href }: { weeks: readonly ForecastWeek[]; href: string }) {
  if (weeks.length === 0) return null;
  const label = (w: ForecastWeek) => `${w.index + 1}. hf · ${shortDayTr(w.start)}`;
  const data = weeks.map((w) => ({ hafta: label(w), giris: w.inflow, cikis: w.outflow, href }));
  return (
    <div className="grid gap-3">
      <div className="h-[240px]">
        <BarCompare
          data={data}
          xKey="hafta"
          series={[
            { key: "giris", label: "Beklenen giriş", color: "var(--viz-2)" },
            { key: "cikis", label: "Beklenen çıkış", color: "var(--viz-3)" },
          ]}
          format="money"
          hrefKey="href"
          ariaLabel="13 haftalık beklenen giriş ve çıkış"
          emptyText="Önümüzdeki 13 haftada vadesi gelen kalem yok"
        />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-[var(--radius-card)] border border-line">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Haftalık tahmini nakit akışı</caption>
          <thead className="sticky top-0 bg-canvas text-text-muted">
            <tr>
              <th scope="col" className="px-3 py-1.5 font-semibold">Hafta</th>
              <th scope="col" className="px-3 py-1.5 text-right font-semibold">Net</th>
              <th scope="col" className="px-3 py-1.5 text-right font-semibold">Hafta sonu bakiye</th>
              <th scope="col" className="hidden px-3 py-1.5 text-right font-semibold sm:table-cell">En düşük</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start} className={cn("border-t border-line", w.breach && "bg-danger-soft/40")}>
                <th scope="row" className="px-3 py-1.5 font-normal">
                  <Link href={href} className="font-semibold text-accent-text hover:underline">
                    {shortDayTr(w.start)}–{shortDayTr(w.end)}
                  </Link>
                </th>
                <td className={cn("numeric px-3 py-1.5 text-right", w.net < 0 ? "text-danger-strong" : "text-text")}>{money(w.net)}</td>
                <td className="numeric px-3 py-1.5 text-right font-semibold">{money(w.endBalance)}</td>
                <td className={cn("numeric hidden px-3 py-1.5 text-right sm:table-cell", w.breach ? "font-semibold text-danger-strong" : "text-text-muted")}>
                  {money(w.minBalance)} <span className="text-text-faint">({shortDayTr(w.minDay)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
