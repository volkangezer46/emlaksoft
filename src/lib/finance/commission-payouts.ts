/**
 * Danışman hakediş ödemesi — SAF planlama (DB'siz, test edilebilir). Eylem: src/app/actions/commission-payouts.ts.
 *
 * Kural (migration 20260816000400): split başına iptal edilmemiş TEK hakediş. Bu yüzden:
 *  - Hakedişi olmayan danışman payı → yeni "paid" satırı (insert).
 *  - Bekleyen/onaylı hakedişi olan pay → aynı satır "paid"e yükseltilir (promote); yeni satır açılmaz.
 *  - Ödenmiş hakedişi olan pay → atlanır (çift ödeme yok).
 *  - Tutarı 0 olan ya da profili olmayan pay ödenmez.
 */

export type PayoutSplit = {
  id: string;
  commission_id: string;
  profile_id: string;
  amount: number | string;
  label?: string | null;
};

export type ExistingPayout = {
  id: string;
  split_id: string | null;
  status: string;
  approved_at: string | null;
};

export type PayoutPlan = {
  inserts: PayoutSplit[];
  promotes: { payoutId: string; approvedAt: string | null; split: PayoutSplit }[];
  alreadyPaid: PayoutSplit[];
};

export function planPayouts(splits: readonly PayoutSplit[], existing: readonly ExistingPayout[]): PayoutPlan {
  const bySplit = new Map<string, ExistingPayout>();
  for (const p of existing) {
    if (!p.split_id || p.status === "cancelled") continue;
    bySplit.set(p.split_id, p);
  }
  const plan: PayoutPlan = { inserts: [], promotes: [], alreadyPaid: [] };
  for (const s of splits) {
    if (!s.profile_id) continue;
    const amount = Number(s.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const prior = bySplit.get(s.id);
    if (!prior) plan.inserts.push(s);
    else if (prior.status === "paid") plan.alreadyPaid.push(s);
    else plan.promotes.push({ payoutId: prior.id, approvedAt: prior.approved_at, split: s });
  }
  return plan;
}

export type CommissionPayoutState = "payable" | "paid" | "none";

/**
 * Komisyon defteri satırı için hakediş durumu: ödenecek danışman payı varsa "payable", tüm danışman payları
 * ödenmişse "paid", danışman payı yoksa "none". Tahsil edilmemiş komisyon hiçbir zaman "payable" değildir.
 */
export function commissionPayoutState(
  collected: boolean,
  splits: readonly PayoutSplit[],
  existing: readonly ExistingPayout[],
): { state: CommissionPayoutState; payableAmount: number } {
  const plan = planPayouts(splits, existing);
  const payableAmount = [...plan.inserts, ...plan.promotes.map((p) => p.split)].reduce((s, x) => s + Number(x.amount), 0);
  if (payableAmount > 0) return { state: collected ? "payable" : "none", payableAmount: collected ? payableAmount : 0 };
  if (plan.alreadyPaid.length > 0) return { state: "paid", payableAmount: 0 };
  return { state: "none", payableAmount: 0 };
}
