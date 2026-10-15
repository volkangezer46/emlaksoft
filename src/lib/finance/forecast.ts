/**
 * Nakit akışı tahmini yorumlayıcısı (SAF; DB/saat yok). Girdi `finance_cashflow_forecast` RPC'sinin günlük noktalarıdır
 * (gerçekleşen geçmiş + bugünden itibaren tahmin: açık alacak/borç vadeleri, kira, tahsil edilmemiş komisyon ve düzenli
 * ödemeler). Burada yalnız TAHMİN günleri yorumlanır:
 *  - `weeklyForecast`: 13 haftalık (91 gün) görünüm için 7'şer günlük kovalar (giriş, çıkış, net, hafta sonu ve en düşük bakiye)
 *  - `forecastInsights`: başlangıç/bitiş bakiyesi, en düşük nokta, eşiğin İLK aşıldığı gün ("X tarihinde kasa eksiye düşebilir")
 * Test: forecast.test.ts.
 */

export type ForecastDayPoint = { date: string; inflow: number; outflow: number; balance: number; isActual: boolean };

export type ForecastWeek = {
  /** 0'dan başlayan hafta sırası (0 = bu hafta, bugünden itibaren 7 gün). */
  index: number;
  start: string;
  end: string;
  inflow: number;
  outflow: number;
  net: number;
  /** Haftanın son günündeki tahmini bakiye. */
  endBalance: number;
  /** Hafta içindeki en düşük gün sonu bakiye ve günü. */
  minBalance: number;
  minDay: string;
  /** Hafta içinde bakiye eşiğin altına iniyor mu. */
  breach: boolean;
};

export type ForecastInsights = {
  /** Tahminin ilk gününden ÖNCEKİ bakiye (bugünün hareketleri hariç güncel nakit). */
  startBalance: number;
  endBalance: number;
  netChange: number;
  totalIn: number;
  totalOut: number;
  lowest: { date: string; balance: number } | null;
  /** Bakiyenin eşiğin altına İLK indiği gün; inmiyorsa null. */
  firstBreach: { date: string; balance: number } | null;
  /** Tahmin başından ilk aşıma kadar geçen gün (0 = bugün). */
  daysUntilBreach: number | null;
  threshold: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fin = (n: number) => (Number.isFinite(n) ? n : 0);

function futureOnly(points: readonly ForecastDayPoint[]): ForecastDayPoint[] {
  return points.filter((p) => !p.isActual).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Tahmin günlerini 7'şer günlük kovalara böler (en çok `weeks` hafta). Son kova eksik günlü olabilir. */
export function weeklyForecast(points: readonly ForecastDayPoint[], opts: { weeks?: number; threshold?: number } = {}): ForecastWeek[] {
  const weeks = Math.max(1, Math.min(53, Math.round(opts.weeks ?? 13)));
  const threshold = fin(opts.threshold ?? 0);
  const days = futureOnly(points).slice(0, weeks * 7);
  const out: ForecastWeek[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    let inflow = 0;
    let outflow = 0;
    let min = chunk[0]!;
    for (const d of chunk) {
      inflow += fin(d.inflow);
      outflow += fin(d.outflow);
      if (fin(d.balance) < fin(min.balance)) min = d;
    }
    const last = chunk[chunk.length - 1]!;
    out.push({
      index: out.length,
      start: chunk[0]!.date,
      end: last.date,
      inflow: round2(inflow),
      outflow: round2(outflow),
      net: round2(inflow - outflow),
      endBalance: round2(fin(last.balance)),
      minBalance: round2(fin(min.balance)),
      minDay: min.date,
      breach: fin(min.balance) < threshold,
    });
  }
  return out;
}

/** Tahmin özeti; `threshold` ofisin en düşük bakiye eşiği (yoksa 0 = eksiye düşme). Tahmin günü yoksa null. */
export function forecastInsights(points: readonly ForecastDayPoint[], threshold: number | null | undefined): ForecastInsights | null {
  const days = futureOnly(points);
  if (days.length === 0) return null;
  const t = fin(threshold ?? 0);
  const first = days[0]!;
  const startBalance = round2(fin(first.balance) - fin(first.inflow) + fin(first.outflow));
  let totalIn = 0;
  let totalOut = 0;
  let lowest = first;
  let breach: ForecastDayPoint | null = null;
  let breachIdx: number | null = null;
  days.forEach((d, i) => {
    totalIn += fin(d.inflow);
    totalOut += fin(d.outflow);
    if (fin(d.balance) < fin(lowest.balance)) lowest = d;
    if (!breach && fin(d.balance) < t) {
      breach = d;
      breachIdx = i;
    }
  });
  const last = days[days.length - 1]!;
  const b = breach as ForecastDayPoint | null;
  return {
    startBalance,
    endBalance: round2(fin(last.balance)),
    netChange: round2(fin(last.balance) - startBalance),
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
    lowest: { date: lowest.date, balance: round2(fin(lowest.balance)) },
    firstBreach: b ? { date: b.date, balance: round2(fin(b.balance)) } : null,
    daysUntilBreach: breachIdx,
    threshold: t,
  };
}

/** "YYYY-MM-DD" → "GG.AA". */
export function shortDayTr(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

/** Uyarı başlığı: eşik yoksa "kasa eksiye düşebilir", varsa "eşiğin altına inebilir". */
export function breachHeadline(ins: ForecastInsights, hasThreshold: boolean): string | null {
  if (!ins.firstBreach) return null;
  const when = ins.daysUntilBreach === 0 ? "Bugün" : `${shortDayTr(ins.firstBreach.date)} tarihinde`;
  return hasThreshold ? `${when} bakiye en düşük eşiğin altına inebilir` : `${when} kasa eksiye düşebilir`;
}
