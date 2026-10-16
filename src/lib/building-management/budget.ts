/**
 * Bina İŞLETME PROJESİ (yıllık bütçe) SAF kuralları: kalem doğrulama, yıllık toplam, aylık avans, dönem listesi, bütçe/gerçekleşen
 * karşılaştırması. Saat, DB ve ağ okunmaz; tarihler `YYYY-MM-DD` (TR günü) olarak dışarıdan verilir. Tüm toplamlar kuruş üzerinden.
 *
 * Kat Mülkiyeti Kanunu bağlamı (bilgi amaçlı, hukuki görüş değildir): yönetici yıllık işletme projesi hazırlar (m.35), proje kat
 * malikleri kurulunca kabul edilir ve tebliğinden sonra yedi gün içinde itiraz edilmezse kesinleşir (m.37); ortak giderler aksine
 * sözleşme yoksa arsa payı oranında paylaşılır (m.20). Bu modül yalnız hesap yapar; karar metni "öneri" olarak etiketlenir.
 */
import { fromKurus, toKurus } from "@/lib/property-management/payments";
import { parseMoneyInput } from "@/lib/money-input";
import { addMonths } from "./period";

/** Bütçe kalem kategorileri = ortak gider paylaştırma kategorileri (gerçekleşen bu anahtarla eşleşir). */
export const BUILDING_EXPENSE_CATEGORIES = [
  "Asansör",
  "Temizlik",
  "Elektrik",
  "Su",
  "Isıtma / doğalgaz",
  "Bakım-onarım",
  "Güvenlik",
  "Bahçe",
  "Sigorta",
  "Personel",
  "Yönetim ücreti",
  "Yedek akçe",
  "Diğer",
] as const;

/** Bütçede izin verilen dağıtımlar: sabit tutar avans için anlamsız (toplam bütçeden türemez). */
export const BUDGET_DISTRIBUTIONS = ["land_share", "equal", "area"] as const;
export type BudgetDistribution = (typeof BUDGET_DISTRIBUTIONS)[number];
export const isBudgetDistribution = (v: unknown): v is BudgetDistribution =>
  typeof v === "string" && (BUDGET_DISTRIBUTIONS as readonly string[]).includes(v);

export const BUDGET_STATUS_LABELS = { draft: "Taslak", approved: "Onaylı" } as const;
export type BudgetStatus = keyof typeof BUDGET_STATUS_LABELS;

export const MAX_BUDGET_LINES = 60;
export const OTHER_CATEGORY = "Diğer";

export type BudgetLine = { category: string | null; label: string; amount: number };

export type ParsedBudgetLines = { ok: true; lines: BudgetLine[]; total: number } | { ok: false; error: string };

function toAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const r = parseMoneyInput(typeof v === "string" ? v : "", { max: 1_000_000_000 });
  return r.ok ? r.value : null;
}

/** İstemciden gelen kalemleri doğrular; boş satırlar (ad ve tutar boş) sessizce atlanır. */
export function parseBudgetLines(raw: unknown): ParsedBudgetLines {
  if (!Array.isArray(raw)) return { ok: false, error: "Bütçe kalemleri okunamadı." };
  const lines: BudgetLine[] = [];
  let totalK = 0;
  for (const [i, item] of raw.entries()) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const label = String(r.label ?? "").trim();
    const amountRaw = r.amount;
    const empty = !label && (amountRaw == null || String(amountRaw).trim() === "");
    if (empty) continue;
    if (label.length < 1 || label.length > 120) return { ok: false, error: `${i + 1}. kalemin adını yazın (en çok 120 karakter).` };
    const amount = toAmount(amountRaw);
    if (amount == null || amount < 0.01 || amount > 1_000_000_000) {
      return { ok: false, error: `“${label}” için geçerli, en çok iki ondalık haneli bir yıllık tutar girin.` };
    }
    const categoryRaw = String(r.category ?? "").trim();
    if (categoryRaw.length > 60) return { ok: false, error: "Kategori en fazla 60 karakter olabilir." };
    const k = toKurus(amount);
    totalK += k;
    lines.push({ category: categoryRaw || null, label, amount: fromKurus(k) });
  }
  if (lines.length === 0) return { ok: false, error: "En az bir bütçe kalemi girin." };
  if (lines.length > MAX_BUDGET_LINES) return { ok: false, error: `En çok ${MAX_BUDGET_LINES} kalem girilebilir.` };
  if (totalK > 1_000_000_000 * 100) return { ok: false, error: "Bütçe toplamı çok büyük." };
  return { ok: true, lines, total: fromKurus(totalK) };
}

/** Yıllık (dönem) toplamı. */
export function budgetTotal(lines: readonly Pick<BudgetLine, "amount">[]): number {
  return fromKurus(lines.reduce((s, l) => s + toKurus(l.amount), 0));
}

/** Aylık avans = toplam / ay (kuruşa yuvarlanır; SQL `round(total / months, 2)` ile aynı). */
export function monthlyAdvance(total: number, months: number): number {
  const m = Math.max(1, Math.trunc(months));
  return fromKurus(Math.round(toKurus(total) / m));
}

/** Aylık avans × ay ile yıllık toplam arasındaki yuvarlama farkı (+: toplanan bütçeden fazla). */
export function advanceRoundingGap(total: number, months: number): number {
  return fromKurus(toKurus(monthlyAdvance(total, months)) * Math.max(1, Math.trunc(months)) - toKurus(total));
}

/** Bütçe penceresindeki dönemler (`YYYY-MM-01`). */
export function budgetPeriods(periodStart: string, months: number): string[] {
  const start = periodStart.slice(0, 7);
  return Array.from({ length: Math.max(1, Math.trunc(months)) }, (_, i) => `${addMonths(start, i)}-01`);
}

/** Bütçe penceresinin son günü dahil bitiş ayı (`YYYY-MM`). */
export function budgetEndMonth(periodStart: string, months: number): string {
  return addMonths(periodStart.slice(0, 7), Math.max(1, Math.trunc(months)) - 1);
}

/** Bugüne kadar başlamış ay sayısı (pencere içinde 1..months; önce 0, sonra months). */
export function monthsElapsed(periodStart: string, months: number, today: string): number {
  const [sy, sm] = periodStart.slice(0, 7).split("-").map(Number) as [number, number];
  const [ty, tm] = today.slice(0, 7).split("-").map(Number) as [number, number];
  const diff = (ty * 12 + tm) - (sy * 12 + sm) + 1;
  return Math.min(Math.max(diff, 0), Math.max(1, Math.trunc(months)));
}

/** Bütçe dönemi etiketi: "Ocak 2027 – Aralık 2027". */
export function budgetPeriodLabel(periodStart: string, months: number): string {
  const fmt = (ym: string) => {
    const [y, m] = ym.split("-").map(Number) as [number, number];
    return `${TR_MONTHS[m - 1]} ${y}`;
  };
  return `${fmt(periodStart.slice(0, 7))} – ${fmt(budgetEndMonth(periodStart, months))}`;
}

export const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"] as const;

export function monthLabelTr(period: string): string {
  const [y, m] = period.slice(0, 7).split("-").map(Number) as [number, number];
  return `${TR_MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Bütçe / gerçekleşen
// ---------------------------------------------------------------------------

export type ActualExpense = { category: string | null; amount: number; period: string };

export type BudgetVsActualRow = {
  category: string;
  planned: number;
  plannedToDate: number;
  actual: number;
  /** gerçekleşen − bugüne kadarki plan (+: aşım). */
  variance: number;
  /** Gerçekleşen / yıllık plan (%), plan yoksa null. */
  usedPct: number | null;
  status: "ok" | "watch" | "over" | "unplanned";
};

export type BudgetVsActual = {
  rows: BudgetVsActualRow[];
  totals: { planned: number; plannedToDate: number; actual: number; variance: number; usedPct: number | null };
  elapsed: number;
  months: number;
};

/**
 * Plan (kalemlerin kategori toplamı) ile gerçekleşen (bütçe penceresindeki ortak gider paylaştırmaları, kategori bazında) karşılaştırması.
 * Bugüne kadarki plan = yıllık plan × geçen ay / ay (doğrusal). Kategorisiz kalem/gider "Diğer"e düşer.
 * Durum: aşım (gerçekleşen > yıllık plan) · izle (gerçekleşen > bugüne kadarki plan × 1,10) · planlanmamış (plan yok, gider var).
 */
export function budgetVsActual(input: {
  lines: readonly BudgetLine[];
  periodStart: string;
  months: number;
  today: string;
  actuals: readonly ActualExpense[];
}): BudgetVsActual {
  const months = Math.max(1, Math.trunc(input.months));
  const elapsed = monthsElapsed(input.periodStart, months, input.today);
  const startKey = input.periodStart.slice(0, 7);
  const endKey = budgetEndMonth(input.periodStart, months);
  const plannedK = new Map<string, number>();
  const order: string[] = [];
  const key = (c: string | null) => (c && c.trim() ? c.trim() : OTHER_CATEGORY);
  for (const l of input.lines) {
    const k = key(l.category);
    if (!plannedK.has(k)) order.push(k);
    plannedK.set(k, (plannedK.get(k) ?? 0) + toKurus(l.amount));
  }
  const actualK = new Map<string, number>();
  for (const a of input.actuals) {
    const ym = a.period.slice(0, 7);
    if (ym < startKey || ym > endKey) continue;
    const k = key(a.category);
    if (!plannedK.has(k) && !actualK.has(k)) order.push(k);
    actualK.set(k, (actualK.get(k) ?? 0) + toKurus(a.amount));
  }
  let tp = 0;
  let tpd = 0;
  let ta = 0;
  const rows = order.map((category): BudgetVsActualRow => {
    const p = plannedK.get(category) ?? 0;
    const pd = Math.round((p * elapsed) / months);
    const a = actualK.get(category) ?? 0;
    tp += p;
    tpd += pd;
    ta += a;
    const status: BudgetVsActualRow["status"] =
      p === 0 ? (a > 0 ? "unplanned" : "ok") : a > p ? "over" : a > Math.round(pd * 1.1) ? "watch" : "ok";
    return {
      category,
      planned: fromKurus(p),
      plannedToDate: fromKurus(pd),
      actual: fromKurus(a),
      variance: fromKurus(a - pd),
      usedPct: p > 0 ? Math.round((a / p) * 1000) / 10 : null,
      status,
    };
  });
  return {
    rows,
    totals: { planned: fromKurus(tp), plannedToDate: fromKurus(tpd), actual: fromKurus(ta), variance: fromKurus(ta - tpd), usedPct: tp > 0 ? Math.round((ta / tp) * 1000) / 10 : null },
    elapsed,
    months,
  };
}

export const BUDGET_ROW_STATUS_LABELS: Record<BudgetVsActualRow["status"], string> = {
  ok: "Planda",
  watch: "İzle",
  over: "Bütçe aşıldı",
  unplanned: "Plansız gider",
};

/** Avans tahsilat özeti: bütçeden tahakkuk eden aylar ve tahsil edilen. */
export function advanceCollection(charges: readonly { amount: number; paid: number }[]): { charged: number; collected: number; outstanding: number; rate: number } {
  let c = 0;
  let p = 0;
  for (const x of charges) {
    const a = toKurus(x.amount);
    c += a;
    p += Math.min(toKurus(x.paid), a);
  }
  return { charged: fromKurus(c), collected: fromKurus(p), outstanding: fromKurus(c - p), rate: c > 0 ? Math.round((p / c) * 1000) / 10 : 0 };
}
