/**
 * Danışman kârlılığı (SAF; yalnız owner/gm görür — kazanç gizliliği P12 ile uyumlu, çağıran sayfa kapıyı uygular).
 *
 *   ofiste kalan = komisyon (brüt) − KDV − ofis DIŞINA dağıtılan paylar (danışman, referans, franchise...)
 *   net katkı    = ofiste kalan − doğrudan maliyet
 *   doğrudan maliyet = danışmanın portföylerine bağlı gider kayıtları (`expenses.property_id` → `properties.assigned_to`)
 *
 * Portföye bağlanmamış (ortak) giderler danışmana PAYLAŞTIRILMAZ; toplamı ayrıca bildirilir. Paylaşımı tanımlanmamış
 * komisyon varsa uyarı sayısı döner (payı bilinmiyor).
 */

export type AdvisorCommission = { commissionId: string; advisorId: string; gross: number; vat: number; status: string };
export type AdvisorSplit = { commissionId: string; kind: string; amount: number };
export type AdvisorExpense = { advisorId: string | null; amount: number };

export type AdvisorProfitRow = {
  advisorId: string;
  name: string;
  commissions: number;
  gross: number;
  retained: number;
  directCosts: number;
  net: number;
  unsplit: number;
};

export type AdvisorProfitability = {
  rows: AdvisorProfitRow[];
  /** Danışmana atanamayan (ortak) gider toplamı — paylaştırılmadı. */
  unattributedExpenses: number;
};

export function computeAdvisorProfitability(
  commissions: readonly AdvisorCommission[],
  splits: readonly AdvisorSplit[],
  expenses: readonly AdvisorExpense[],
  names: ReadonlyMap<string, string>,
): AdvisorProfitability {
  const splitsBy = new Map<string, AdvisorSplit[]>();
  for (const s of splits) splitsBy.set(s.commissionId, [...(splitsBy.get(s.commissionId) ?? []), s]);

  const rows = new Map<string, AdvisorProfitRow>();
  const row = (id: string): AdvisorProfitRow => {
    let r = rows.get(id);
    if (!r) {
      r = { advisorId: id, name: names.get(id) ?? "Danışman", commissions: 0, gross: 0, retained: 0, directCosts: 0, net: 0, unsplit: 0 };
      rows.set(id, r);
    }
    return r;
  };

  for (const c of commissions) {
    if (c.status === "cancelled" || !c.advisorId) continue;
    const r = row(c.advisorId);
    r.commissions += 1;
    r.gross += c.gross;
    const own = splitsBy.get(c.commissionId) ?? [];
    if (own.length === 0) r.unsplit += 1;
    const out = own.filter((s) => s.kind !== "office").reduce((a, s) => a + s.amount, 0);
    r.retained += c.gross - c.vat - out;
  }

  let unattributed = 0;
  for (const e of expenses) {
    if (!e.advisorId) {
      unattributed += e.amount;
      continue;
    }
    row(e.advisorId).directCosts += e.amount;
  }

  const list = [...rows.values()]
    .map((r) => ({ ...r, retained: Math.round(r.retained), gross: Math.round(r.gross), directCosts: Math.round(r.directCosts), net: Math.round(r.retained - r.directCosts) }))
    .filter((r) => r.commissions > 0 || r.directCosts > 0)
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, "tr"));
  return { rows: list, unattributedExpenses: Math.round(unattributed) };
}
