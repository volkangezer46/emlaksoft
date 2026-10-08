/**
 * Mülk sahibi hakediş defteri (SAF). Bakiye SAKLANMAZ; kayıtlardan her seferinde türer.
 *
 * Tanımlar (ekranda, portalda ve raporda da yazılır):
 *  - Tahsil edilen kira = iptal edilmemiş tahsilatlar (ay = tahsilat tarihi).
 *  - Yönetim ücreti = tahsilat anında kaydedilen ofis ücreti (yüzde ya da sabit TL/ay; kuruşa yuvarlı).
 *  - Gider / aidat = hakedişe YANSITILAN mülke ait kalemler (ay = gider tarihi / aidat dönemi).
 *  - Hakediş = tahsilat − yönetim ücreti − gider − aidat.
 *  - Bakiye = (dönem hakedişleri toplamı) − (mülk sahibine yapılan, iptal edilmemiş ödemeler).
 *    Pozitif = ofis mülk sahibine borçlu (ödenecek); negatif = mülk sahibi ofise borçlu (fazla ödeme / alacak).
 * Tüm hesap kuruş (tam sayı) üzerinden yapılır; toplamlar kayan nokta sapması taşımaz.
 */
import { fromKurus, toKurus } from "./payments";

export type LedgerPayment = { id: string; paidOn: string; amount: number; managementFee: number; receiptNo?: number | null };
export type LedgerCharge = { id: string; kind: "expense" | "due"; date: string; amount: number; label: string };
export type LedgerPayout = { id: string; paidOn: string; amount: number; reference?: string | null };

export type LedgerEntryKind = "rent" | "fee" | "expense" | "due" | "payout";
export type LedgerEntry = {
  id: string;
  date: string;
  month: string;
  kind: LedgerEntryKind;
  label: string;
  /** Mülk sahibi lehine işaretli tutar: tahsilat +, ücret/gider/aidat −, ödeme −. */
  signed: number;
};

export type LedgerMonth = {
  month: string;
  collected: number;
  fee: number;
  expenses: number;
  dues: number;
  /** Hakediş = tahsilat − ücret − gider − aidat. */
  entitlement: number;
  paidOut: number;
  /** Ay sonu devreden bakiye (pozitif = ödenecek). */
  closing: number;
};

export type OwnerLedger = {
  months: LedgerMonth[];
  entries: LedgerEntry[];
  totals: { collected: number; fee: number; expenses: number; dues: number; entitlement: number; paidOut: number; balance: number };
  /** Ofisin mülk sahibine şimdi ödemesi gereken tutar (negatif bakiye 0'a iner). */
  payable: number;
  hasData: boolean;
};

const monthOf = (day: string) => day.slice(0, 7);

export function computeOwnerLedger(input: {
  payments: readonly LedgerPayment[];
  charges: readonly LedgerCharge[];
  payouts: readonly LedgerPayout[];
}): OwnerLedger {
  const byMonth = new Map<string, { collected: number; fee: number; expenses: number; dues: number; paidOut: number }>();
  const slot = (m: string) => {
    let s = byMonth.get(m);
    if (!s) {
      s = { collected: 0, fee: 0, expenses: 0, dues: 0, paidOut: 0 };
      byMonth.set(m, s);
    }
    return s;
  };
  const entries: LedgerEntry[] = [];

  for (const p of input.payments) {
    const m = monthOf(p.paidOn);
    const amt = toKurus(p.amount);
    const fee = toKurus(p.managementFee);
    slot(m).collected += amt;
    entries.push({ id: `rent:${p.id}`, date: p.paidOn.slice(0, 10), month: m, kind: "rent", label: p.receiptNo ? `Kira tahsilatı (makbuz ${p.receiptNo})` : "Kira tahsilatı", signed: fromKurus(amt) });
    if (fee > 0) {
      slot(m).fee += fee;
      entries.push({ id: `fee:${p.id}`, date: p.paidOn.slice(0, 10), month: m, kind: "fee", label: "Yönetim ücreti", signed: -fromKurus(fee) });
    }
  }
  for (const c of input.charges) {
    const m = monthOf(c.date);
    const amt = toKurus(c.amount);
    if (c.kind === "expense") slot(m).expenses += amt;
    else slot(m).dues += amt;
    entries.push({ id: `${c.kind}:${c.id}`, date: c.date.slice(0, 10), month: m, kind: c.kind, label: c.label, signed: -fromKurus(amt) });
  }
  for (const o of input.payouts) {
    const m = monthOf(o.paidOn);
    const amt = toKurus(o.amount);
    slot(m).paidOut += amt;
    entries.push({ id: `payout:${o.id}`, date: o.paidOn.slice(0, 10), month: m, kind: "payout", label: o.reference ? `Mülk sahibine ödeme (${o.reference})` : "Mülk sahibine ödeme", signed: -fromKurus(amt) });
  }

  const keys = [...byMonth.keys()].sort();
  let running = 0;
  const totalsK = { collected: 0, fee: 0, expenses: 0, dues: 0, paidOut: 0 };
  const months: LedgerMonth[] = keys.map((month) => {
    const s = byMonth.get(month)!;
    const entitlementK = s.collected - s.fee - s.expenses - s.dues;
    running += entitlementK - s.paidOut;
    totalsK.collected += s.collected;
    totalsK.fee += s.fee;
    totalsK.expenses += s.expenses;
    totalsK.dues += s.dues;
    totalsK.paidOut += s.paidOut;
    return {
      month,
      collected: fromKurus(s.collected),
      fee: fromKurus(s.fee),
      expenses: fromKurus(s.expenses),
      dues: fromKurus(s.dues),
      entitlement: fromKurus(entitlementK),
      paidOut: fromKurus(s.paidOut),
      closing: fromKurus(running),
    };
  });
  const entitlementTotalK = totalsK.collected - totalsK.fee - totalsK.expenses - totalsK.dues;
  const balanceK = entitlementTotalK - totalsK.paidOut;
  entries.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  return {
    months,
    entries,
    totals: {
      collected: fromKurus(totalsK.collected),
      fee: fromKurus(totalsK.fee),
      expenses: fromKurus(totalsK.expenses),
      dues: fromKurus(totalsK.dues),
      entitlement: fromKurus(entitlementTotalK),
      paidOut: fromKurus(totalsK.paidOut),
      balance: fromKurus(balanceK),
    },
    payable: fromKurus(Math.max(0, balanceK)),
    hasData: entries.length > 0,
  };
}

export const OWNER_BALANCE_NOTE =
  "Hakediş = tahsil edilen kira − yönetim ücreti − hakedişe yansıtılan gider ve aidat. Bakiye, ödemeler düşüldükten sonra kalandır; " +
  "pozitif bakiye mülk sahibine ödenecek, negatif bakiye mülk sahibinden alacak anlamına gelir. Vergi hesaplanmaz.";

/** Bakiye etiketi (ekran/portal/rapor tek metin). */
export function balanceLabel(balance: number): string {
  const k = toKurus(balance);
  if (k > 0) return "Mülk sahibine ödenecek";
  if (k < 0) return "Mülk sahibinden alacak (fazla ödeme)";
  return "Bakiye yok";
}

/** Yönetim ücreti özeti metni: "%8" ya da "₺1.500 / ay". */
export function feeDescription(feeType: "percent" | "fixed", feeValue: number): string {
  if (feeType === "percent") return `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(feeValue)}`;
  return `${new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(feeValue)} / ay`;
}

/** Ödeme tutarı bakiyeyi aşıyor mu (peşin ödeme uyarısı)? */
export function exceedsBalance(balance: number, payoutAmount: number): boolean {
  return toKurus(payoutAmount) > Math.max(0, toKurus(balance));
}

