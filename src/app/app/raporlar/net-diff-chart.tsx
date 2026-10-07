import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import Link from "@/components/ui/smart-link";
import { cn } from "@/lib/utils";
import { divergingBars, type NetPoint } from "./report-math";

const moneyFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const money = (n: number) => `${moneyFmt.format(n)} ₺`;

/**
 * NetDiffChart — aylık net (gelir - gider) sapma çubukları. Sıfır çizgisi ortada; pozitif
 * net yukarı (başarı tonu), negatif aşağı (tehlike tonu). Yalnız gerçek veriyle çizilir
 * (çağıran `hasNetData` ile korur). Renk tek başına anlam taşımaz: her sütunun altında
 * işaretli değer metni vardır; sr-only tablo tam veriyi verir. Sütun > komisyon/gider hedefine bağlıdır.
 * Hareket yok (durağan); SSR saf CSS.
 */
export function NetDiffChart({ points, className }: { points: readonly NetPoint[]; className?: string }) {
  const bars = divergingBars(points);
  const HALF = 56; // px, sıfır çizgisinin üstü/altı
  return (
    <figure className={cn("m-0", className)}>
      <div
        role="img"
        aria-label={`Aylık net fark (gelir eksi gider), ${points.length} ay`}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, bars.length)}, minmax(0, 1fr))` }}
      >
        {bars.map((b) => {
          const h = Math.round((b.pct / 100) * HALF);
          const pos = b.net >= 0;
          return (
            <Link
              key={b.label}
              href={pos ? "/app/komisyon" : "/app/giderler"}
              className="focus-ring group flex flex-col items-stretch rounded-[var(--radius-control)] px-0.5 transition hover:bg-surface-hover"
              title={`${b.label}: ${money(b.net)}`}
            >
              <span className="flex items-end justify-center" style={{ height: HALF }}>
                {pos && h > 0 ? (
                  <span className="w-full max-w-8 rounded-t-[4px]" style={{ height: h, background: "var(--viz-pos)" }} />
                ) : null}
              </span>
              <span aria-hidden="true" className="h-px w-full bg-line-strong" />
              <span className="flex items-start justify-center" style={{ height: HALF }}>
                {!pos && h > 0 ? (
                  <span className="w-full max-w-8 rounded-b-[4px]" style={{ height: h, background: "var(--viz-neg)" }} />
                ) : null}
              </span>
              <span className="pt-1 text-center text-xs font-medium text-text-faint">{b.label}</span>
              <span
                className="pb-1 text-center text-xs font-semibold tabular-nums"
                style={{ color: pos ? "var(--viz-pos)" : "var(--viz-neg)" }}
              >
                {pos ? "+" : "−"}
                {moneyFmt.format(Math.abs(b.net))}
              </span>
            </Link>
          );
        })}
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
