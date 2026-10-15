/**
 * Kârlılık karşılaştırmaları (SAF; DB/saat yok). Girdi `finance_pnl` RPC'sinin aylık satırlarıdır (gelir = ofise kalan
 * komisyon + yönetim ücreti + elle girilen gelir; gider = ofis giderleri; TL, örnek veri hariç).
 *  - `yearOverYear`: son N ayın her biri ↔ geçen yılın aynı ayı (gelir, gider, net ve değişim yüzdesi) + yılbaşından bugüne
 *    (YBB) toplam karşılaştırması. İçinde bulunulan ay "devam ediyor" işaretlidir.
 *  - `incomeSourceMix`: gelir kaynaklarının payı (komisyon, yönetim ücreti, diğer kategoriler).
 * Test: profitability.test.ts.
 */

export type PnlMonthInput = { month: string; income: number; expense: number; incomeByCategory?: Record<string, number> };

export type YoyMonth = {
  key: string;
  income: number;
  expense: number;
  net: number;
  prevIncome: number;
  prevExpense: number;
  prevNet: number;
  /** Gelir değişimi (%); geçen yıl 0 ise null. */
  incomeChange: number | null;
  /** Net değişimi (%); geçen yılın neti 0 ise null. Eksi netten iyileşmede pozitif olur (mutlak değere göre). */
  netChange: number | null;
  partial: boolean;
};

export type YoyTotals = { income: number; expense: number; net: number; prevIncome: number; prevExpense: number; prevNet: number; incomeChange: number | null; netChange: number | null };

export type YoyResult = { months: YoyMonth[]; ytd: YoyTotals; hasPrevYear: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;
const fin = (n: unknown) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
};

export function shiftMonth(key: string, delta: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}

/** Yüzde değişim; taban 0 ise null. Eksi tabanda mutlak değere bölünür (zarardan kâra geçiş pozitif görünür). */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function yearOverYear(rows: readonly PnlMonthInput[], currentMonth: string, months = 12): YoyResult {
  const byKey = new Map<string, PnlMonthInput>();
  for (const r of rows) byKey.set(r.month.slice(0, 7), r);
  const n = Math.max(1, Math.min(24, Math.round(months)));
  const keys = Array.from({ length: n }, (_, i) => shiftMonth(currentMonth, -(n - 1 - i)));
  let hasPrevYear = false;
  const out: YoyMonth[] = keys.map((key) => {
    const cur = byKey.get(key);
    const prev = byKey.get(shiftMonth(key, -12));
    const income = fin(cur?.income);
    const expense = fin(cur?.expense);
    const prevIncome = fin(prev?.income);
    const prevExpense = fin(prev?.expense);
    if (prevIncome !== 0 || prevExpense !== 0) hasPrevYear = true;
    return {
      key,
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
      prevIncome: round2(prevIncome),
      prevExpense: round2(prevExpense),
      prevNet: round2(prevIncome - prevExpense),
      incomeChange: pctChange(income, prevIncome),
      netChange: pctChange(income - expense, prevIncome - prevExpense),
      partial: key === currentMonth,
    };
  });

  // YBB: bu yılın Ocak..bu ay ↔ geçen yılın Ocak..aynı ay (bu ay kısmi; geçen yılın aynı ayı tam sayılır, not düşülür).
  const year = currentMonth.slice(0, 4);
  const month = Number(currentMonth.slice(5, 7));
  let income = 0;
  let expense = 0;
  let prevIncome = 0;
  let prevExpense = 0;
  for (let m = 1; m <= month; m++) {
    const k = `${year}-${String(m).padStart(2, "0")}`;
    const cur = byKey.get(k);
    const prev = byKey.get(shiftMonth(k, -12));
    income += fin(cur?.income);
    expense += fin(cur?.expense);
    prevIncome += fin(prev?.income);
    prevExpense += fin(prev?.expense);
  }
  const ytd: YoyTotals = {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    prevIncome: round2(prevIncome),
    prevExpense: round2(prevExpense),
    prevNet: round2(prevIncome - prevExpense),
    incomeChange: pctChange(income, prevIncome),
    netChange: pctChange(income - expense, prevIncome - prevExpense),
  };
  return { months: out, ytd, hasPrevYear };
}

export type IncomeSource = { key: string; total: number; share: number };

/** Gelir kategorilerinin toplamı ve yüzdesi (büyükten küçüğe); sıfır/eksi kalemler atılır. `top` sonrası "diger" altında toplanır. */
export function incomeSourceMix(rows: readonly PnlMonthInput[], opts: { top?: number; otherKey?: string } = {}): IncomeSource[] {
  const top = Math.max(1, opts.top ?? 5);
  const otherKey = opts.otherKey ?? "__diger";
  const sums = new Map<string, number>();
  for (const r of rows) for (const [k, v] of Object.entries(r.incomeByCategory ?? {})) sums.set(k, (sums.get(k) ?? 0) + fin(v));
  const list = [...sums.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = list.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return [];
  const head = list.slice(0, top);
  const rest = list.slice(top).reduce((a, [, v]) => a + v, 0);
  const items = head.map(([key, v]) => ({ key, total: round2(v), share: Math.round((v / total) * 1000) / 10 }));
  if (rest > 0) items.push({ key: otherKey, total: round2(rest), share: Math.round((rest / total) * 1000) / 10 });
  return items;
}
