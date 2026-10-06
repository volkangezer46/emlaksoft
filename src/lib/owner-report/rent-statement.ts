/**
 * Malik kira ekstresi (SAF): dönem (yıl) içindeki tahakkuk, tahsilat ve bakım giderleri → net.
 *
 * Tanımlar (ekranda da yazılır): Tahsilat = durumu "ödendi" olan tahakkuklar (ödeme tarihi dönem içinde; yoksa tahakkuk
 * ayı). Gider = tamamlanmış bakım taleplerinin girilmiş maliyeti (kayıt tarihine göre). Net = tahsilat − gider.
 * Ofis hizmet bedeli/komisyon veya vergi bu ekstrede HESAPLANMAZ (kayıt yok; uydurulmaz). Vergi beyanı için değildir.
 */

export type StatementCharge = { period: string; amount: number; status: string; paidAt: string | null };
export type StatementExpense = { title: string; cost: number | null; status: string; createdAt: string };

export type StatementMonth = { month: string; accrued: number; collected: number; expense: number; net: number; overdue: number };

export type RentStatement = {
  year: number;
  months: StatementMonth[];
  totals: { accrued: number; collected: number; expense: number; net: number; overdue: number };
  expenses: { title: string; cost: number; date: string }[];
  hasData: boolean;
};

/** Ay anahtarı (TR saati): zaman damgası UTC ise +3 saat kaydırılır; yalnız tarih ise olduğu gibi. */
function monthKey(iso: string): string {
  if (!iso.includes("T")) return iso.slice(0, 7);
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + 3 * 3_600_000).toISOString().slice(0, 7) : iso.slice(0, 7);
}
function dayKey(iso: string): string {
  if (!iso.includes("T")) return iso.slice(0, 10);
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10) : iso.slice(0, 10);
}

export function buildRentStatement(year: number, charges: readonly StatementCharge[], expenses: readonly StatementExpense[]): RentStatement {
  const prefix = String(year);
  const months: StatementMonth[] = Array.from({ length: 12 }, (_, i) => ({
    month: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    accrued: 0,
    collected: 0,
    expense: 0,
    net: 0,
    overdue: 0,
  }));
  const byKey = new Map(months.map((m) => [m.month, m]));

  for (const c of charges) {
    const accruedKey = monthKey(c.period);
    const accrued = byKey.get(accruedKey);
    if (accrued) {
      accrued.accrued += c.amount;
      if (c.status === "overdue") accrued.overdue += c.amount;
    }
    if (c.status === "paid") {
      const target = byKey.get(monthKey(c.paidAt ?? c.period));
      if (target) target.collected += c.amount;
    }
  }
  const expenseRows: { title: string; cost: number; date: string }[] = [];
  for (const e of expenses) {
    if (e.status !== "done" || e.cost == null || !(e.cost > 0)) continue;
    const m = byKey.get(monthKey(e.createdAt));
    if (!m) continue;
    m.expense += e.cost;
    expenseRows.push({ title: e.title, cost: e.cost, date: dayKey(e.createdAt) });
  }
  for (const m of months) m.net = m.collected - m.expense;
  const totals = months.reduce(
    (acc, m) => ({
      accrued: acc.accrued + m.accrued,
      collected: acc.collected + m.collected,
      expense: acc.expense + m.expense,
      net: acc.net + m.net,
      overdue: acc.overdue + m.overdue,
    }),
    { accrued: 0, collected: 0, expense: 0, net: 0, overdue: 0 },
  );
  return {
    year,
    months,
    totals,
    expenses: expenseRows.sort((a, b) => (a.date < b.date ? -1 : 1)),
    hasData: totals.accrued > 0 || totals.collected > 0 || totals.expense > 0,
  };
}

/** Kira geliri beyanı hatırlatması yalnız Şubat-Mart'ta gösterilir (tutar YAZILMAZ). `todayKey` = trDayKey(). */
export function showRentDeclarationReminder(todayKey: string): boolean {
  const m = Number(todayKey.slice(5, 7));
  return m === 2 || m === 3;
}

export const RENT_DECLARATION_NOTE =
  "Konut/işyeri kira gelirleri için yıllık gelir vergisi beyanı genellikle Mart ayında verilir. Beyan yükümlülüğünüzü, " +
  "istisna ve gider yöntemini mali müşavirinize danışın. Bu ekstre ofis kayıtlarındaki tahsilatları özetler; beyan tutarı hesaplamaz.";

/** Ekstrede seçilebilir yıllar: en eski kira başlangıcından bu yıla (en çok 6 yıl). */
export function statementYears(firstStartDay: string | null, currentYear: number): number[] {
  const first = firstStartDay ? Number(firstStartDay.slice(0, 4)) : currentYear;
  const from = Math.max(first, currentYear - 5);
  const out: number[] = [];
  for (let y = currentYear; y >= from; y--) out.push(y);
  return out;
}
