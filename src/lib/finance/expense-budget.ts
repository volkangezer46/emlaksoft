/**
 * Gider bütçesi (SAF). Kategori başına aylık bütçe ↔ gerçekleşen harcama; %80 uyarı, %100 aşım, önceki aya sapma.
 * Bütçe tutarı yoksa/0 ise satır üretilmez (bütçesiz kategori için "aşım" iddia edilmez).
 */

export const BUDGET_WARN_RATIO = 0.8;
export const BUDGET_OVER_RATIO = 1;

export type BudgetStatus = "ok" | "warn" | "over";

export type BudgetInput = { category: string; monthlyAmount: number };

export type BudgetRow = {
  category: string;
  budget: number;
  spent: number;
  /** spent / budget (0..∞). */
  ratio: number;
  status: BudgetStatus;
  /** Bütçeden kalan (negatif = aşım tutarı). */
  remaining: number;
  prevSpent: number;
  /** Bu ay − önceki ay (TL). */
  deltaVsPrev: number;
  /** Önceki ay 0 ise null (yüzde tanımsız). */
  deltaPctVsPrev: number | null;
};

export function budgetStatus(spent: number, budget: number): BudgetStatus {
  if (!(budget > 0)) return "ok";
  const ratio = spent / budget;
  if (ratio >= BUDGET_OVER_RATIO) return "over";
  if (ratio >= BUDGET_WARN_RATIO) return "warn";
  return "ok";
}

const money = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
};

/** Toplam gerçekleşeni kategoriye göre toplar (kayıt yoksa boş). */
export function sumByCategory(rows: readonly { category: string; amount: number | string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.category, (out.get(r.category) ?? 0) + money(r.amount));
  return out;
}

/** Bütçeli kategoriler için satırlar; en çok kullanılan oran üstte. */
export function computeBudgetRows(
  budgets: readonly BudgetInput[],
  spentThisMonth: ReadonlyMap<string, number>,
  spentPrevMonth: ReadonlyMap<string, number>,
): BudgetRow[] {
  const rows: BudgetRow[] = [];
  for (const b of budgets) {
    const budget = money(b.monthlyAmount);
    if (!(budget > 0)) continue;
    const spent = money(spentThisMonth.get(b.category));
    const prevSpent = money(spentPrevMonth.get(b.category));
    rows.push({
      category: b.category,
      budget,
      spent,
      ratio: spent / budget,
      status: budgetStatus(spent, budget),
      remaining: budget - spent,
      prevSpent,
      deltaVsPrev: spent - prevSpent,
      deltaPctVsPrev: prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null,
    });
  }
  return rows.sort((a, b) => b.ratio - a.ratio || a.category.localeCompare(b.category, "tr"));
}

/** Bütçe girdisi: virgül/nokta ve boşluk toleranslı, > 0 ve makul üst sınır. Geçersizse null. */
export function parseBudgetAmount(raw: unknown): number | null {
  const text = String(raw ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  // "12.500,50" (TR) ve "12500.50" (düz) ikisini de kabul et.
  const normalized = /,\d{1,2}$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
  return Math.round(n * 100) / 100;
}
