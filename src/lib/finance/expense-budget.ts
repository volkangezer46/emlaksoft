import { foldTr } from "@/lib/tr-text";
import { BUDGET_GROUP_LABEL, CASH_CATEGORIES, SALARY_CATEGORY, budgetCategoryFor, budgetGroupMembers } from "@/lib/finance/cash/categories";

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

/* ------------------------------------------------------------------------------------------------
 * Muhasebe v2 (FN6) saf yardımcıları: aylık bütçe–gerçekleşen (finance_budget_vs_actual), KDV özeti
 * (finance_vat_summary), kâr/zarar nakit eki (finance_pnl) ve stopajlı kira dökümü. RPC satırları gevşek
 * gelir (numeric metin olabilir); burada sayıya çevrilir.
 * ---------------------------------------------------------------------------------------------- */

export type BudgetDirection = "in" | "out";

/** `finance_budget_vs_actual` satırı (RPC çıktısı). */
export type BudgetVsActualRaw = { direction?: unknown; category?: unknown; budget?: unknown; actual?: unknown };

export type BudgetVsActualRow = {
  direction: BudgetDirection;
  category: string;
  budget: number;
  actual: number;
  /** actual / budget (bütçe 0 ise 0). */
  ratio: number;
  /** Gider: %80 uyarı, %100 aşım. Gelir: hedefin %80'inin altı "under", üstü "ok". */
  status: BudgetStatus | "under";
  /** Gider: bütçeden kalan (negatif = aşım). Gelir: hedefe kalan (negatif = hedef aşıldı). */
  remaining: number;
};

/**
 * Ofisin geliri SAYILMAYAN giriş kategorileri (bütçe ↔ gerçekleşen): kira/aidat tahsilatı mülk sahibinin parasıdır,
 * transfer hesaplar arası aktarımdır. Hedef tanımlanamazlar; bütçesiz gerçekleşen satırları da gelir toplamını şişirmesin diye atılır.
 */
export const BUDGET_INCOME_PASS_THROUGH: ReadonlySet<string> = new Set(["kira_tahsilat", "aidat_tahsilat", "transfer"]);

export type BudgetCategoryChoice = {
  /** finance_budgets.category anahtarı (SQL eşlemesinden sonra). */
  value: string;
  label: string;
  hint: string;
  /** Bu bütçeye sayılan diğer hareket kategorilerinin etiketleri (ör. ofis → Kira, Aidat, Muhasebe). */
  includes: readonly string[];
};

/**
 * Bütçe formu kategori seçenekleri (SAF; SK6/B102). Gider yönünde sistem kategorileri `budgetCategoryFor` ile bütçe anahtarına
 * iner ve tekilleşir: 'Kira', 'Aidat', 'Muhasebe' ayrı seçenek değildir, "Ofis gideri (kira, aidat, muhasebe dahil)" tek seçenektir.
 * Gider tanımları ve ofis kategorileri aynı anahtara düşüyorsa tekrar etmez. Gelir yönünde eşleme yok; mülk sahibinin parası/transfer çıkmaz.
 */
export function budgetCategoryOptions(
  direction: BudgetDirection,
  defs: readonly { value: string; label: string }[],
  custom: readonly { key: string; label: string; direction: string; archived_at: string | null }[],
  canSalary: boolean,
): BudgetCategoryChoice[] {
  const out: BudgetCategoryChoice[] = [];
  const seen = new Set<string>();
  const push = (raw: string, label: string, hint: string) => {
    const value = budgetCategoryFor(raw, direction);
    if (!value || seen.has(value)) return;
    seen.add(value);
    const members = direction === "out" ? budgetGroupMembers(value).filter((c) => c.value !== value) : [];
    out.push({
      value,
      label: (direction === "out" && BUDGET_GROUP_LABEL[value]) || label,
      hint,
      includes: members.map((c) => c.label),
    });
  };
  for (const c of CASH_CATEGORIES) {
    if (c.direction !== direction) continue;
    if (c.value === SALARY_CATEGORY && !canSalary) continue;
    // Mülk sahibinin parası / transfer (ofis geliri değil): hedef seçeneklerinde çıkmaz (gerçekleşende de sayılmaz).
    if (BUDGET_INCOME_PASS_THROUGH.has(c.value)) continue;
    push(c.value, c.label, "Sistem kategorisi");
  }
  if (direction === "out") for (const d of defs) push(d.value, d.label, "Gider kategorisi");
  for (const c of custom) if (c.direction === direction && !c.archived_at) push(c.key, c.label, "Ofis kategorisi");
  return out;
}

/** RPC satırlarını sayıya çevirip durumlarıyla döndürür; bütçesi ve gerçekleşeni olmayan satır atılır. Gelir üstte. */
export function budgetVsActualRows(raw: readonly BudgetVsActualRaw[]): BudgetVsActualRow[] {
  const rows: BudgetVsActualRow[] = [];
  for (const r of raw) {
    const direction: BudgetDirection = r.direction === "in" ? "in" : "out";
    const category = String(r.category ?? "").trim();
    if (!category) continue;
    const budget = money(r.budget);
    const actual = money(r.actual);
    if (!(budget > 0) && !(actual > 0)) continue;
    if (direction === "in" && !(budget > 0) && BUDGET_INCOME_PASS_THROUGH.has(category)) continue;
    const ratio = budget > 0 ? actual / budget : 0;
    const status: BudgetVsActualRow["status"] =
      direction === "out" ? budgetStatus(actual, budget) : budget > 0 && ratio < BUDGET_WARN_RATIO ? "under" : "ok";
    rows.push({ direction, category, budget, actual, ratio, status, remaining: round2(budget - actual) });
  }
  return rows.sort((a, b) =>
    a.direction === b.direction ? Number(b.budget > 0) - Number(a.budget > 0) || b.ratio - a.ratio || a.category.localeCompare(b.category, "tr") : a.direction === "in" ? -1 : 1,
  );
}

/** Yön bazında toplamlar: bütçe, tüm gerçekleşen, bütçeli kategorilerin gerçekleşeni ve aşım sayısı. */
export function budgetTotals(rows: readonly BudgetVsActualRow[], direction: BudgetDirection): { budget: number; actual: number; budgetedActual: number; over: number } {
  let budget = 0;
  let actual = 0;
  let budgetedActual = 0;
  let over = 0;
  for (const r of rows) {
    if (r.direction !== direction) continue;
    budget += r.budget;
    actual += r.actual;
    if (r.budget > 0) budgetedActual += r.actual;
    if (direction === "out" && r.budget > 0 && r.status === "over") over += 1;
  }
  return { budget: round2(budget), actual: round2(actual), budgetedActual: round2(budgetedActual), over };
}

/** `?ay=YYYY-MM` -> geçerliyse anahtar, değilse varsayılan. */
export function parseMonthKey(raw: unknown, fallback: string): string {
  const v = String(raw ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return fallback;
  const year = Number(v.slice(0, 4));
  return year >= 2000 && year <= 2100 ? v : fallback;
}

/** Ay anahtarının ilk ve son günü (YYYY-MM-DD). */
export function monthBounds(monthKey: string): { from: string; to: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, "0")}` };
}

/** Ay anahtarını `delta` ay kaydırır. */
export function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** `finance_vat_summary` satırı. */
export type VatSummaryRaw = { month?: unknown; output_vat?: unknown; input_vat?: unknown; payable?: unknown; withholding_paid?: unknown; withholding_collected?: unknown };
export type VatSummaryRow = { month: string; outputVat: number; inputVat: number; payable: number; withholdingPaid: number; withholdingCollected: number };

/** KDV özeti satırı: ödenecek = hesaplanan − indirilecek (eksi ise devreden KDV). Ekranda bu formül esastır. */
export function vatSummaryRows(raw: readonly VatSummaryRaw[]): VatSummaryRow[] {
  return raw
    .map((r) => {
      const outputVat = round2(money(r.output_vat));
      const inputVat = round2(money(r.input_vat));
      return {
        month: String(r.month ?? "").slice(0, 7),
        outputVat,
        inputVat,
        payable: round2(outputVat - inputVat),
        withholdingPaid: round2(money(r.withholding_paid)),
        withholdingCollected: round2(money(r.withholding_collected)),
      };
    })
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Satırların toplamı (ödenecek yine hesaplanan − indirilecek). */
export function vatTotals(rows: readonly VatSummaryRow[]): Omit<VatSummaryRow, "month"> {
  const t = rows.reduce(
    (a, r) => ({ outputVat: a.outputVat + r.outputVat, inputVat: a.inputVat + r.inputVat, withholdingPaid: a.withholdingPaid + r.withholdingPaid, withholdingCollected: a.withholdingCollected + r.withholdingCollected }),
    { outputVat: 0, inputVat: 0, withholdingPaid: 0, withholdingCollected: 0 },
  );
  return {
    outputVat: round2(t.outputVat),
    inputVat: round2(t.inputVat),
    payable: round2(t.outputVat - t.inputVat),
    withholdingPaid: round2(t.withholdingPaid),
    withholdingCollected: round2(t.withholdingCollected),
  };
}

/** Tarih listesini ay anahtarına göre sayar ("KDV bilgisi yok" sayacı). */
export function countByMonth(dates: readonly (string | null | undefined)[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of dates) {
    const key = String(d ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key)) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** finance_pnl `*_by_category` jsonb: nesne ({kategori: tutar}) ya da dizi ([{category, amount}]) kabul edilir. */
export function categoryAmounts(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: unknown, v: unknown) => {
    const key = String(k ?? "").trim();
    const n = money(v);
    if (key && n !== 0) out.set(key, round2((out.get(key) ?? 0) + n));
  };
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return out;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        add(o.category ?? o.key ?? o.kategori, o.amount ?? o.total ?? o.tutar);
      }
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) add(k, v);
  }
  return out;
}

/**
 * Kâr/zarara EK gelir sayılmayan gelir kategorileri: komisyon `commissions` tablosundan (tahakkuk) zaten sayılır;
 * kira/aidat tahsilatı mülk sahibinin parasıdır (ofise kalan yönetim ücreti ayrıca sayılır). Böylece komisyon ve
 * kira İKİ KEZ sayılmaz.
 */
export const PNL_INCOME_EXCLUDED: ReadonlySet<string> = new Set(["komisyon", "kira_tahsilat", "aidat_tahsilat", "kira_yonetimi", "transfer"]);

/** `finance_pnl` satırı. */
export type PnlRaw = { month?: unknown; income?: unknown; expense?: unknown; net?: unknown; income_by_category?: unknown; expense_by_category?: unknown };
export type PnlCashMonth = {
  /** YYYY-MM */
  key: string;
  /** Elle girilen gelir (hizmet bedeli, diğer gelir, ofis kategorileri...). */
  manualIncome: number;
  manualIncomeByCategory: Record<string, number>;
  income: number;
  /** finance_pnl gideri (expenses + deftere bağlı olmayan çıkışlar). */
  expense: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
};

/** finance_pnl satırlarını ay anahtarına göre düz JSON'a çevirir (önbelleğe yazılabilir). */
export function pnlCashMonths(raw: readonly PnlRaw[]): PnlCashMonth[] {
  const out: PnlCashMonth[] = [];
  for (const r of raw) {
    const key = String(r.month ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const incomeByCategory = Object.fromEntries(categoryAmounts(r.income_by_category));
    const expenseByCategory = Object.fromEntries(categoryAmounts(r.expense_by_category));
    const manualIncomeByCategory = Object.fromEntries(Object.entries(incomeByCategory).filter(([k, v]) => !PNL_INCOME_EXCLUDED.has(k) && v > 0));
    const manualIncome = round2(Object.values(manualIncomeByCategory).reduce((s, v) => s + v, 0));
    out.push({ key, manualIncome, manualIncomeByCategory, income: round2(money(r.income)), expense: round2(money(r.expense)), incomeByCategory, expenseByCategory });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Kâr/zarar ayı için defterden gelen EK gider: finance_pnl gideri `expenses` + deftere bağlı olmayan çıkışlardır;
 * `expenses` kısmı zaten sayıldığından yalnız aradaki fark (maaş, gidere dönüşmemiş çıkışlar) eklenir; negatif olamaz.
 */
export function pnlExtraExpense(pnlExpense: number, expensesAllInMonth: number): number {
  return Math.max(0, round2(pnlExpense - expensesAllInMonth));
}

/**
 * Kâr/zarar ayları için defter eki: ay başına elle girilen gelir ve `expenses` dışı EK gider. `expenseRows` ofisin
 * `expenses` satırlarıdır; mülk sahibine yansıtılanlar (`passThrough`) finance_pnl'de de sayılmadığından farka katılmaz.
 * Yönetim ücreti (`kira_yonetimi`) buildProfitLoss'ta ayrıca sayıldığından elle gelire eklenmez.
 * `cash` null ise (RPC yok) ek sıfırdır: sayfa eski hesapla aynen çalışır.
 */
export function cashPnlAdjustments(
  monthKeys: readonly string[],
  cash: readonly PnlCashMonth[] | null | undefined,
  expenseRows: readonly { date: string; amount: number; passThrough?: boolean }[],
): Map<string, { manualIncome: number; extraExpense: number }> {
  const out = new Map<string, { manualIncome: number; extraExpense: number }>(monthKeys.map((k) => [k, { manualIncome: 0, extraExpense: 0 }]));
  if (!cash || cash.length === 0) return out;
  const expensesAll = new Map<string, number>();
  for (const e of expenseRows) {
    if (e.passThrough) continue;
    const k = String(e.date).slice(0, 7);
    expensesAll.set(k, (expensesAll.get(k) ?? 0) + money(e.amount));
  }
  for (const c of cash) {
    const slot = out.get(c.key);
    if (!slot) continue;
    slot.manualIncome = c.manualIncome;
    const base = expensesAll.get(c.key) ?? 0;
    slot.extraExpense = pnlExtraExpense(c.expense, base);
    // Defter gideri `expenses`ten küçükse fark kırpılır (0); tarih/kapsam uyuşmazlığı sessiz kalmasın diye iz bırakılır.
    if (c.expense - base < -1) console.warn("finance pnl: defter gideri expenses toplamından küçük, fark kırpıldı", { month: c.key, diff: round2(c.expense - base) });
  }
  return out;
}

/** Kategori kırılımlarını aylar boyunca toplar (büyükten küçüğe). */
export function sumCategoryRecords(records: readonly Record<string, number>[]): { category: string; total: number }[] {
  const out = new Map<string, number>();
  for (const rec of records) for (const [k, v] of Object.entries(rec)) out.set(k, round2((out.get(k) ?? 0) + money(v)));
  return [...out].map(([category, total]) => ({ category, total })).filter((r) => r.total !== 0).sort((a, b) => b.total - a.total);
}

/** Stopajlı kira dökümü: brüt kiradan stopaj kesilir, mal sahibine net ödenir (stopaj vergi dairesine). */
export function rentWithholdingBreakdown(gross: number, ratePct: number): { gross: number; withheld: number; net: number } {
  const g = round2(money(gross));
  const rate = money(ratePct);
  if (!(g > 0)) return { gross: 0, withheld: 0, net: 0 };
  if (!(rate > 0)) return { gross: g, withheld: 0, net: g };
  const withheld = round2((g * rate) / 100);
  return { gross: g, withheld, net: round2(g - withheld) };
}

/** KDV ayrıştırma (dahil/hariç), 2 hane yuvarlama. */
export function vatBreakdown(amount: number, ratePct: number, included: boolean): { net: number; vat: number; gross: number } {
  const a = money(amount);
  const rate = money(ratePct);
  if (!(rate > 0)) return { net: round2(a), vat: 0, gross: round2(a) };
  if (included) {
    const net = round2(a / (1 + rate / 100));
    return { net, vat: round2(a - net), gross: round2(a) };
  }
  const vat = round2((a * rate) / 100);
  return { net: round2(a), vat, gross: round2(a + vat) };
}

/** Oran girdisi (KDV / stopaj yüzdesi): boş -> null, 0..100 arası en çok 2 hane; geçersiz -> undefined. */
export function parseRatePct(raw: unknown): number | null | undefined {
  const text = String(raw ?? "").trim().replace(",", ".").replace("%", "");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

/** Ofis kategorisi anahtarı: `x_` + Türkçe katlanmış kısa ad ("Noter Masrafı" -> "x_noter_masrafi"). */
export function customCategoryKey(label: string): string {
  const slug = foldTr(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30)
    .replace(/_+$/g, "");
  return slug ? `x_${slug}` : "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
