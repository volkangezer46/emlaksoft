/**
 * Hızlı gelir/gider formunun "Ne için?" kategorileri (SAF). Tasarım: docs/design/FINANS_KASA_EFATURA_TASARIM_2026-10.md (a).
 * Gider kategorisi, ofis gideri üretilirken `expenses.category` tanım değerlerine (definition-defaults EXPENSE_CATEGORIES) eşlenir;
 * böylece Giderler özeti/kâr-zarar mevcut kategori kırılımıyla çalışmaya devam eder.
 */
export type CashDirection = "in" | "out";

export type CashCategory = { value: string; label: string; direction: CashDirection; expenseCategory?: string };

export const SALARY_CATEGORY = "maas";
export const TRANSFER_CATEGORY = "transfer";
/** Mülk sahibi hakediş ödemesinin kasa çıkışı kategorisi (elle seçilemez; yalnız owner_payout kaynağı yazar). */
export const OWNER_PAYOUT_CATEGORY = "mulk_sahibi_odeme";
/** Kiracı depozitosu (emanet; giriş = alındı, çıkış = iade). Elle seçilemez; yalnız rental_deposit_post yazar. K/Z dışıdır. */
export const DEPOSIT_CATEGORY = "depozito";

export const CASH_CATEGORIES: readonly CashCategory[] = [
  // Gider
  { value: "kira", label: "Kira", direction: "out", expenseCategory: "ofis" },
  { value: "aidat", label: "Aidat", direction: "out", expenseCategory: "ofis" },
  { value: "maas", label: "Maaş", direction: "out" },
  { value: "sgk", label: "SGK / vergi", direction: "out", expenseCategory: "diger" },
  { value: "muhasebe", label: "Muhasebe", direction: "out", expenseCategory: "ofis" },
  { value: "portal", label: "Portal üyeliği", direction: "out", expenseCategory: "reklam" },
  { value: "reklam", label: "Reklam", direction: "out", expenseCategory: "reklam" },
  { value: "ulasim", label: "Ulaşım", direction: "out", expenseCategory: "ulasim" },
  { value: "ofis", label: "Ofis gideri", direction: "out", expenseCategory: "ofis" },
  { value: "diger_gider", label: "Diğer gider", direction: "out", expenseCategory: "diger" },
  // Gelir
  { value: "komisyon", label: "Komisyon", direction: "in" },
  { value: "hizmet_bedeli", label: "Hizmet bedeli", direction: "in" },
  { value: "kira_yonetimi", label: "Kira yönetimi", direction: "in" },
  { value: "aidat_yonetimi", label: "Aidat yönetimi", direction: "in" },
  { value: "kira_tahsilat", label: "Kira tahsilatı", direction: "in" },
  { value: "aidat_tahsilat", label: "Aidat tahsilatı", direction: "in" },
  { value: "diger_gelir", label: "Diğer gelir", direction: "in" },
] as const;

export function categoriesFor(direction: CashDirection): readonly CashCategory[] {
  return CASH_CATEGORIES.filter((c) => c.direction === direction);
}

export function cashCategoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === TRANSFER_CATEGORY) return "Transfer";
  if (value === OWNER_PAYOUT_CATEGORY) return "Mülk sahibi ödemesi";
  if (value === DEPOSIT_CATEGORY) return "Depozito (emanet)";
  return CASH_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function isCashCategory(value: string, direction: CashDirection): boolean {
  return CASH_CATEGORIES.some((c) => c.value === value && c.direction === direction);
}

/** Ofis gideri kaydında kullanılacak `expenses.category` değeri; maaş gider kaydına DÖNÜŞMEZ (null). */
export function expenseCategoryFor(value: string): string | null {
  if (value === SALARY_CATEGORY) return null;
  return CASH_CATEGORIES.find((c) => c.value === value && c.direction === "out")?.expenseCategory ?? "diger";
}

/**
 * Bütçe anahtarı (SAF): SQL `finance_v2_budget_category` (20261014001100) karşılığı. Gider yönünde sistem hareket kategorisi
 * gider kategorisine iner (kira/aidat/muhasebe/ofis → ofis, portal/reklam → reklam, sgk/diğer gider → diger); maaş ve ofisin
 * kendi kategorileri olduğu gibi kalır. Gelir yönünde eşleme yok. SK6/B102: bütçe formu seçenekleri ve "mevcut tutar"
 * araması bu anahtarla yapılır; 'Kira' seçip kaydetmek artık sessizce 'Ofis gideri' bütçesini ezmez.
 */
export function budgetCategoryFor(value: string, direction: CashDirection): string {
  const v = value.trim();
  if (direction !== "out" || v === SALARY_CATEGORY || !isCashCategory(v, "out")) return v;
  return expenseCategoryFor(v) ?? v;
}

/** Birden çok hareket kategorisini kapsayan bütçe anahtarlarının birleşik etiketi (form seçeneği). */
export const BUDGET_GROUP_LABEL: Readonly<Record<string, string>> = {
  ofis: "Ofis gideri (kira, aidat, muhasebe dahil)",
  reklam: "Reklam (portal dahil)",
  diger: "Diğer (SGK/vergi dahil)",
};

/** Bu bütçe anahtarına sayılan gider hareket kategorileri (anahtarın kendisi dahil, etiketleriyle). */
export function budgetGroupMembers(key: string): readonly CashCategory[] {
  return CASH_CATEGORIES.filter((c) => c.direction === "out" && c.value !== SALARY_CATEGORY && budgetCategoryFor(c.value, "out") === key);
}

/** Var olan bir gider kaydı hesaba bağlanırken hareket kategorisi (gider kategorisinden türer). */
export function cashCategoryForExpense(expenseCategory: string): string {
  return expenseCategory === "reklam" || expenseCategory === "ofis" || expenseCategory === "ulasim" ? expenseCategory : "diger_gider";
}

/** Maaş hareketlerini yalnız ofis sahibi ve genel müdür görür/yazar (koordinatör kararı 2026-10-10). */
export function canHandleSalary(role: string | null | undefined): boolean {
  return role === "owner" || role === "gm";
}
