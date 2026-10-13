import { dayNumber, isoFromDayNumber } from "@/lib/finance/statement/match";

/**
 * Hesap kartının son 30 gün bakiye çizgisi (sunucu bileşeni, saf SVG; grafik kütüphanesi yok, ilk yük bütçesine yük
 * getirmez). Seri, bugünkü bakiyeden geriye doğru günlük net hareketler çıkarılarak kurulur: gün sonu bakiyesi.
 */

export type DayMove = { date: string; direction: "in" | "out"; amount: number };

/** Gün sonu bakiyeleri (eskiden yeniye, `days` nokta; son nokta bugünün bakiyesi). Saf; tarih nesnesi yok. */
export function dailyBalanceSeries(currentBalance: number, moves: readonly DayMove[], today: string, days = 30): { date: string; balance: number }[] {
  const end = dayNumber(today);
  const start = end - days + 1;
  const netByDay = new Map<number, number>();
  for (const m of moves) {
    const d = dayNumber(m.date);
    if (d < start || d > end) continue;
    netByDay.set(d, (netByDay.get(d) ?? 0) + (m.direction === "in" ? m.amount : -m.amount));
  }
  const out: { date: string; balance: number }[] = [];
  let balance = currentBalance;
  for (let d = end; d >= start; d -= 1) {
    out.push({ date: isoFromDayNumber(d), balance: Math.round(balance * 100) / 100 });
    balance -= netByDay.get(d) ?? 0;
  }
  return out.reverse();
}

/** Seri -> SVG yol noktaları (0..w, 0..h; düz seride orta çizgi). */
export function sparkPoints(values: readonly number[], w: number, h: number, pad = 2): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = span === 0 ? h / 2 : pad + (h - pad * 2) * (1 - (v - min) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function AccountSparkline({ series, label }: { series: readonly { date: string; balance: number }[]; label: string }) {
  if (series.length < 2) return null;
  const values = series.map((s) => s.balance);
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const up = last >= first;
  const W = 120;
  const H = 32;
  const pts = sparkPoints(values, W, H);
  const tone = up ? "var(--success-strong)" : "var(--danger-strong)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <polygon points={`2,${H} ${pts} ${W - 2},${H}`} fill={tone} fillOpacity={0.08} stroke="none" />
      <polyline points={pts} fill="none" stroke={tone} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
