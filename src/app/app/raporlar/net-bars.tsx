import { BarCompare } from "@/components/ui/lazy-charts";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { NetPoint } from "./report-math";

const moneyFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const money = (n: number) => `${moneyFmt.format(n)} ₺`;

/**
 * NetBars — aylık net (gelir - gider) çubukları, ortak canlı grafik seti (`BarCompare`): kâr yukarı (başarı tonu), zarar aşağı
 * (tehlike tonu); üzerine gelince ipucu, çubuğa tıklayınca komisyon (kâr) ya da giderler (zarar) sayfası. Yalnız gerçek veriyle
 * çizilir (çağıran `hasNetData` ile korur). Renk tek başına anlam taşımaz: ipucu ve çubuk ucu işaretli değer verir, sr-only tablo tam veriyi sunar.
 */
export function NetBars({ points, className }: { points: readonly NetPoint[]; className?: string }) {
  return (
    <figure className={cn("m-0", className)} aria-label={`Aylık net fark (gelir eksi gider), ${points.length} ay`}>
      <div className="h-60">
        <BarCompare
          format="money"
          hrefKey="href"
          hint="Ayrıntı için tıklayın"
          colorKey="renk"
          data={points.map((p) => ({
            ay: p.label,
            net: p.net,
            renk: p.net >= 0 ? "var(--viz-pos)" : "var(--viz-neg)",
            href: p.net >= 0 ? "/app/komisyon" : "/app/giderler",
          }))}
          xKey="ay"
          series={[{ key: "net", label: "Net", color: "var(--viz-pos)" }]}
          showValues
        />
      </div>
      <Table className="sr-only">
        <caption>Aylık gelir, gider ve net fark</caption>
        <THead>
          <TR>
            <TH scope="col">Ay</TH>
            <TH scope="col">Gelir</TH>
            <TH scope="col">Gider</TH>
            <TH scope="col">Net</TH>
          </TR>
        </THead>
        <TBody>
          {points.map((p) => (
            <TR key={p.label}>
              <TH scope="row">{p.label}</TH>
              <TD>{money(p.income)}</TD>
              <TD>{money(p.expense)}</TD>
              <TD>{money(p.net)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </figure>
  );
}
