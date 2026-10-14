/**
 * Ofis kâr/zarar (SAF): ay bazında komisyon − KDV − dağıtılan paylar − gider = net.
 *
 * Tanımlar (ekranda da yazılır):
 *  - Komisyon (brüt): `commissions.gross_amount` (= net + KDV, `calculateCommission`); ay = komisyon kaydı tarihi (tahakkuk).
 *    İptal edilen komisyon sayılmaz. Tahsilat (nakit akışı) değil, tahakkuktur.
 *  - Dağıtılan paylar: `commission_splits` satırlarından ofis DIŞINA giden paylar (danışman, referans, franchise, diğer);
 *    `kind = 'office'` ofiste kalır. Paylaşımı tanımlanmamış komisyon sayılır ve uyarılır (payı bilinmiyor).
 *  - Gider: `expenses.amount`, ay = `expense_date`.
 *  - Örnek veri hariç. Vergi (gelir/kurumlar) hesaplanmaz.
 *
 * TEK KAYNAK: ekranlar ve raporlar `computeOfficePnl`'i kullanır (Muhasebe > Raporlar, Rapor merkezi "Kâr / zarar").
 * `buildProfitLoss` defter eki olmadan taban hesaptır; doğrudan ekranda kullanılmaz.
 */
import { cashPnlAdjustments, type PnlCashMonth } from "@/lib/finance/expense-budget";

export type PlCommission = { id: string; createdAt: string; gross: number; vat: number; status: string };
export type PlSplit = { commissionId: string; kind: string; amount: number };
export type PlExpense = { date: string; amount: number; /** Mülk sahibine yansıtılan gider: ofis gideri sayılmaz (mülk sahibinden geri alınır). */ passThrough?: boolean };
export type PlFee = { date: string; amount: number };

export type PlMonth = { key: string; revenue: number; vat: number; shares: number; expenses: number; net: number; commissions: number; fees: number };

export type ProfitLoss = {
  months: PlMonth[];
  totals: Omit<PlMonth, "key">;
  unsplitCount: number;
  hasData: boolean;
};

function trMonth(iso: string): string {
  if (!iso.includes("T")) return iso.slice(0, 7);
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + 3 * 3_600_000).toISOString().slice(0, 7) : iso.slice(0, 7);
}

/** Son `n` TR ayı (eskiden yeniye). `currentKey` = "YYYY-MM". */
export function lastMonthKeys(currentKey: string, n = 12): string[] {
  const [y, m] = currentKey.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function buildProfitLoss(monthKeys: readonly string[], commissions: readonly PlCommission[], splits: readonly PlSplit[], expenses: readonly PlExpense[], fees: readonly PlFee[] = []): ProfitLoss {
  const months = new Map<string, PlMonth>(monthKeys.map((key) => [key, { key, revenue: 0, vat: 0, shares: 0, expenses: 0, net: 0, commissions: 0, fees: 0 }]));
  const splitsBy = new Map<string, PlSplit[]>();
  for (const s of splits) splitsBy.set(s.commissionId, [...(splitsBy.get(s.commissionId) ?? []), s]);
  let unsplitCount = 0;
  for (const c of commissions) {
    if (c.status === "cancelled") continue;
    const m = months.get(trMonth(c.createdAt));
    if (!m) continue;
    m.revenue += c.gross;
    m.vat += c.vat;
    m.commissions += 1;
    const rows = splitsBy.get(c.id) ?? [];
    if (rows.length === 0) unsplitCount += 1;
    for (const s of rows) if (s.kind !== "office") m.shares += s.amount;
  }
  for (const e of expenses) {
    const m = months.get(trMonth(e.date));
    if (m && !e.passThrough) m.expenses += e.amount;
  }
  for (const f of fees) {
    const m = months.get(trMonth(f.date));
    if (m) m.fees += f.amount;
  }
  for (const m of months.values()) m.net = m.revenue + m.fees - m.vat - m.shares - m.expenses;
  const list = [...months.values()];
  const totals = list.reduce(
    (a, m) => ({ revenue: a.revenue + m.revenue, vat: a.vat + m.vat, shares: a.shares + m.shares, expenses: a.expenses + m.expenses, net: a.net + m.net, commissions: a.commissions + m.commissions, fees: a.fees + m.fees }),
    { revenue: 0, vat: 0, shares: 0, expenses: 0, net: 0, commissions: 0, fees: 0 },
  );
  return { months: list, totals, unsplitCount, hasData: totals.revenue > 0 || totals.expenses > 0 || totals.fees > 0 };
}

export type OfficePnlMonth = PlMonth & { /** Muhasebe'de elle girilen gelir (hizmet bedeli, diğer gelir...). */ other: number };
export type OfficePnl = {
  months: OfficePnlMonth[];
  totals: Omit<OfficePnlMonth, "key">;
  unsplitCount: number;
  hasData: boolean;
  /** Defter eki (finance_pnl) bağlı mı: değilse elle girilen gelir ve expenses dışı çıkışlar sayılmaz. */
  cashLinked: boolean;
};

/**
 * Ofis kâr/zararının TEK hesabı: taban (`buildProfitLoss`: komisyon tahakkuku − KDV − dış paylar + yönetim ücreti − gider)
 * + Muhasebe v2 defter eki (`cashPnlAdjustments`: elle girilen gelir, `expenses` dışı çıkışlar). Komisyon ve kira tahsilatı
 * iki kez sayılmaz. `cash` null ise (RPC yok) ek sıfırdır. Ay net'i, finance_pnl'in (gelir − gider) net'iyle aynıdır.
 */
export function computeOfficePnl(
  monthKeys: readonly string[],
  input: { commissions: readonly PlCommission[]; splits: readonly PlSplit[]; expenses: readonly PlExpense[]; fees?: readonly PlFee[]; cash?: readonly PnlCashMonth[] | null },
): OfficePnl {
  const base = buildProfitLoss(monthKeys, input.commissions, input.splits, input.expenses, input.fees ?? []);
  const adj = cashPnlAdjustments(monthKeys, input.cash ?? null, input.expenses);
  const months: OfficePnlMonth[] = base.months.map((m) => {
    const a = adj.get(m.key) ?? { manualIncome: 0, extraExpense: 0 };
    return { ...m, other: a.manualIncome, expenses: m.expenses + a.extraExpense, net: m.net + a.manualIncome - a.extraExpense };
  });
  const totals = months.reduce(
    (t, m) => ({ ...t, other: t.other + m.other, expenses: t.expenses + m.expenses, net: t.net + m.net }),
    { ...base.totals, other: 0, expenses: 0, net: 0 },
  );
  return {
    months,
    totals,
    unsplitCount: base.unsplitCount,
    hasData: base.hasData || totals.other > 0 || totals.expenses > 0,
    cashLinked: Array.isArray(input.cash),
  };
}
