/**
 * Danışman hakediş ödemesi — SAF planlama (DB'siz, test edilebilir). Eylem: src/app/actions/commission-payouts.ts.
 *
 * Kural (migration 20260816000400): split başına iptal edilmemiş TEK hakediş. Bu yüzden:
 *  - Hakedişi olmayan danışman payı → yeni satır (insert; önce "approved" açılır, deftere işlenince "paid").
 *  - Bekleyen/onaylı hakedişi olan pay → aynı satır kullanılır (promote); yeni satır açılmaz.
 *  - Ödenmiş hakedişi olan pay → atlanır (çift ödeme yok).
 *  - Tutarı 0 olan ya da profili olmayan pay ödenmez.
 */
import type { PostingEvent } from "./posting/client";
import { payoutKey } from "./posting/keys";
import { withholding } from "./ledger/vat";
import { filingDueDate } from "./tax-calendar";

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

/* ------------------------------------------------------------------------------------------------
 * Hakediş ödemesinin deftere kaydı (WP3): `payout.paid` (anahtar `payout:{id}`), stopajlı.
 * ---------------------------------------------------------------------------------------------- */

/** Hakediş stopajı oranı üst sınırı (%); gelir vergisi stopaj oranları bunun altındadır. */
export const PAYOUT_WITHHOLDING_MAX = 40;

export type PayoutPayInput = {
  /** Ödemenin çıktığı ofis hesabı (zorunlu). */
  accountId: string;
  /** Stopaj oranı (%); 0 = stopaj yok. Brüt hakediş üzerinden kesilir; danışmana net ödenir, stopaj vergi dairesine borç olur. */
  withholdingRate?: number | null;
  /** Ödeme açıklaması / dekont no. */
  paymentRef?: string | null;
  /** Ödeme tarihi (YYYY-MM-DD); boşsa bugün. */
  date?: string | null;
};

export type ParsedPayoutPay = { accountId: string; withholdingRate: number; paymentRef: string; date: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** SAF: ödeme girdisini doğrular (hesap zorunlu, stopaj 0–40, açıklama ≤ 200, tarih gelecekte değil). */
export function parsePayoutPayInput(raw: PayoutPayInput | null | undefined, today: string): { ok: true; value: ParsedPayoutPay } | { ok: false; error: string } {
  const accountId = String(raw?.accountId ?? "").trim();
  if (!UUID_RE.test(accountId)) return { ok: false, error: "Hakedişin ödendiği ofis hesabını seçin." };
  const rate = raw?.withholdingRate == null || String(raw.withholdingRate).trim() === "" ? 0 : Number(raw.withholdingRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > PAYOUT_WITHHOLDING_MAX) {
    return { ok: false, error: `Stopaj oranı 0 ile ${PAYOUT_WITHHOLDING_MAX} arasında olmalı.` };
  }
  const paymentRef = String(raw?.paymentRef ?? "").trim();
  if (paymentRef.length > 200) return { ok: false, error: "Ödeme açıklaması en fazla 200 karakter olabilir." };
  const date = String(raw?.date ?? "").trim() || today;
  if (!ISO_DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date > today) {
    return { ok: false, error: "Geçerli, gelecekte olmayan bir ödeme tarihi girin." };
  }
  return { ok: true, value: { accountId: accountId.toLowerCase(), withholdingRate: Math.round(rate * 100) / 100, paymentRef, date } };
}

/**
 * SAF: bir hakedişin `payout.paid` olayı. Brüt hakediş = danışman payı; stopaj = brüt × oran (kuruş); danışmana NET ödenir.
 *  - Nakit: ofis hesabından net ÇIKIŞ (`danisman_hakedis`), stopajı `withholding_amount` olarak taşır; danışman pay kalemi
 *    (`split:{id}`, WP2 tahakkuku) açıksa onu kapatır (net + stopaj = brüt).
 *  - Açık kalem: stopaj > 0 ise vergi dairesine borç (`stopaj`), vadesi muhtasar beyan günü (izleyen ayın 26'sı).
 */
export function payoutPaidEvent(args: {
  payoutId: string;
  accountId: string;
  amount: number;
  withholdingRate: number;
  date: string;
  advisorName?: string | null;
  splitItemId?: string | null;
  paymentRef?: string | null;
}): { event: PostingEvent; net: number; withheld: number } {
  const gross = Math.round(Number(args.amount) * 100) / 100;
  const { withheld, net } = args.withholdingRate > 0 ? withholding(gross, args.withholdingRate) : { withheld: 0, net: gross };
  const name = String(args.advisorName ?? "").trim().slice(0, 120);
  const title = (name ? `Hakediş ödemesi: ${name}` : "Hakediş ödemesi").slice(0, 160);
  const event: PostingEvent = {
    eventType: "payout.paid",
    postingKey: payoutKey(args.payoutId),
    date: args.date,
    sourceId: args.payoutId,
    title,
    note: args.paymentRef ? String(args.paymentRef).slice(0, 200) : undefined,
    entries: [
      {
        accountId: args.accountId,
        amount: net,
        title,
        counterparty: name || undefined,
        ...(withheld > 0 ? { withholdingAmount: withheld } : {}),
        ...(args.splitItemId ? { settles: args.splitItemId } : {}),
      },
    ],
    ...(withheld > 0
      ? {
          item: {
            amount: withheld,
            title: (name ? `Hakediş stopajı (vergi dairesi): ${name}` : "Hakediş stopajı (vergi dairesi)").slice(0, 160),
            dueDate: filingDueDate("muhtasar", args.date.slice(0, 7)),
          },
        }
      : {}),
  };
  return { event, net, withheld };
}
