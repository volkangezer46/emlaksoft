import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computeOwnerLedger, type LedgerCharge, type LedgerPayment, type LedgerPayout, type OwnerLedger } from "./ledger";
import { maskIban } from "./iban";
import { LATE_FEE_DEFAULTS, type FeeType, type LateFeeSettings } from "./payments";

/**
 * Mülk yönetimi okuyucuları. İstemci ÇAĞIRANDAN gelir (kullanıcı oturumu = RLS, ya da malik portalının mevcut sunucu istemcisi);
 * her sorgu AÇIK tenant_id süzgeçlidir. Tablo/sütun yoksa (migration uygulanmamış) `available:false` döner, fırlatmaz.
 * IBAN sunucuda yalnız maskelenmek için okunur; istemciye YALNIZ maskeli değer gider. Açık değer yalnız denetimli `revealOwnerIban` eylemindedir.
 */

type DbError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingPmSchema(e: DbError): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "").toLowerCase();
  return (
    code === "42P01" || code === "42703" || code === "PGRST200" || code === "PGRST204" || code === "PGRST205" ||
    msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find")
  );
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type PaymentRow = {
  id: string;
  chargeId: string;
  amount: number;
  paidOn: string;
  method: string;
  bankNote: string | null;
  receiptNo: number;
  managementFee: number;
  legacy: boolean;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

type RawPayment = {
  id: string; charge_id: string; amount: number | string; paid_on: string; method: string; bank_note: string | null;
  receipt_no: number; management_fee: number | string | null; legacy: boolean; created_at: string; voided_at: string | null; void_reason: string | null;
};

const PAYMENT_COLS = "id, charge_id, amount, paid_on, method, bank_note, receipt_no, management_fee, legacy, created_at, voided_at, void_reason";

function mapPayment(r: RawPayment): PaymentRow {
  return {
    id: r.id, chargeId: r.charge_id, amount: num(r.amount), paidOn: String(r.paid_on).slice(0, 10), method: r.method,
    bankNote: r.bank_note, receiptNo: r.receipt_no, managementFee: num(r.management_fee), legacy: r.legacy === true,
    createdAt: r.created_at, voidedAt: r.voided_at, voidReason: r.void_reason,
  };
}

/** Bir kiranın tahsilat kayıtları (iptaller dahil, yeniden eskiye). */
export async function loadRentalPayments(db: SupabaseClient, tenantId: string, rentalId: string): Promise<{ available: boolean; payments: PaymentRow[] }> {
  const res = await db
    .from("rent_payments")
    .select(PAYMENT_COLS)
    .eq("tenant_id", tenantId)
    .eq("rental_id", rentalId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (res.error) return { available: false, payments: [] };
  return { available: true, payments: ((res.data ?? []) as RawPayment[]).map(mapPayment) };
}

export type AgreementView = {
  id: string;
  managed: boolean;
  feeType: FeeType;
  feeValue: number;
  payoutDay: number;
  /** Maskeli IBAN (açık değer sunucuda kalır). */
  ibanMasked: string | null;
  hasIban: boolean;
  accountHolder: string | null;
  notes: string | null;
};

type RawAgreement = {
  id: string; rental_id: string; managed: boolean; fee_type: FeeType; fee_value: number | string; payout_day: number;
  owner_iban: string | null; owner_account_holder: string | null; notes: string | null;
};
const AGREEMENT_COLS = "id, rental_id, managed, fee_type, fee_value, payout_day, owner_iban, owner_account_holder, notes";

function mapAgreement(r: RawAgreement): AgreementView {
  return {
    id: r.id, managed: r.managed === true, feeType: r.fee_type, feeValue: num(r.fee_value), payoutDay: r.payout_day,
    ibanMasked: maskIban(r.owner_iban), hasIban: Boolean(r.owner_iban), accountHolder: r.owner_account_holder, notes: r.notes,
  };
}

export type OwnerFinanceCandidate = { kind: "expense" | "due"; id: string; date: string; label: string; amount: number; linked: boolean };

/** Hakedişe yansıyan kalem türü: gider, tekil mülk aidatı, bina aidatı mahsubu (M2; defterde "aidat" sayılır). */
export type LinkKind = "expense" | "due" | "unit_charge";
const ledgerKind = (k: LinkKind): "expense" | "due" => (k === "expense" ? "expense" : "due");

export type OwnerFinance = {
  available: boolean;
  agreement: AgreementView | null;
  ledger: OwnerLedger;
  payouts: { id: string; paidOn: string; amount: number; method: string; reference: string | null; note: string | null; voidedAt: string | null; voidReason: string | null }[];
  links: { id: string; kind: LinkKind; refId: string; amount: number; date: string; label: string }[];
  candidates: OwnerFinanceCandidate[];
};

const EMPTY_LEDGER = computeOwnerLedger({ payments: [], charges: [], payouts: [] });

/** Bir kiranın mülk sahibi finansı: sözleşme (maskeli), hakediş defteri, ödemeler, yansıtılan/yansıtılabilir gider-aidat. */
export async function loadOwnerFinance(
  db: SupabaseClient,
  input: { tenantId: string; rentalId: string; propertyId: string | null },
): Promise<OwnerFinance> {
  const { tenantId, rentalId, propertyId } = input;
  const empty: OwnerFinance = { available: false, agreement: null, ledger: EMPTY_LEDGER, payouts: [], links: [], candidates: [] };
  const agrRes = await db.from("rental_management_agreements").select(AGREEMENT_COLS).eq("tenant_id", tenantId).eq("rental_id", rentalId).maybeSingle();
  if (agrRes.error) return empty;
  const agreement = agrRes.data ? mapAgreement(agrRes.data as RawAgreement) : null;

  const [payRes, payoutRes, linkRes] = await Promise.all([
    db.from("rent_payments").select("id, paid_on, amount, management_fee, receipt_no").eq("tenant_id", tenantId).eq("rental_id", rentalId).is("voided_at", null).limit(2000),
    db.from("owner_payouts").select("id, paid_on, amount, method, reference, note, voided_at, void_reason").eq("tenant_id", tenantId).eq("rental_id", rentalId).order("paid_on", { ascending: false }).limit(500),
    db.from("owner_charge_links").select("id, kind, ref_id, amount, entry_date, label").eq("tenant_id", tenantId).eq("rental_id", rentalId).limit(1000),
  ]);
  if (payRes.error || payoutRes.error || linkRes.error) return empty;

  const payments: LedgerPayment[] = ((payRes.data ?? []) as { id: string; paid_on: string; amount: number | string; management_fee: number | string | null; receipt_no: number }[]).map((p) => ({
    id: p.id, paidOn: String(p.paid_on).slice(0, 10), amount: num(p.amount), managementFee: num(p.management_fee), receiptNo: p.receipt_no,
  }));
  const links = ((linkRes.data ?? []) as { id: string; kind: LinkKind; ref_id: string; amount: number | string; entry_date: string; label: string }[]).map((l) => ({
    id: l.id, kind: l.kind, refId: l.ref_id, amount: num(l.amount), date: String(l.entry_date).slice(0, 10), label: l.label,
  }));
  const payoutsAll = ((payoutRes.data ?? []) as { id: string; paid_on: string; amount: number | string; method: string; reference: string | null; note: string | null; voided_at: string | null; void_reason: string | null }[]).map((o) => ({
    id: o.id, paidOn: String(o.paid_on).slice(0, 10), amount: num(o.amount), method: o.method, reference: o.reference, note: o.note, voidedAt: o.voided_at, voidReason: o.void_reason,
  }));
  const charges: LedgerCharge[] = links.map((l) => ({ id: l.id, kind: ledgerKind(l.kind), date: l.date, amount: l.amount, label: l.label }));
  const payouts: LedgerPayout[] = payoutsAll.filter((o) => !o.voidedAt).map((o) => ({ id: o.id, paidOn: o.paidOn, amount: o.amount, reference: o.reference }));
  const ledger = computeOwnerLedger({ payments, charges, payouts });

  // Yansıtılabilir kalemler: aynı portföyün giderleri (TRY) + aidatları, henüz başka hakedişe bağlanmamış olanlar.
  const candidates: OwnerFinanceCandidate[] = [];
  if (propertyId) {
    const linkedKeys = new Set(links.map((l) => `${l.kind}:${l.refId}`));
    const [expRes, dueRes] = await Promise.all([
      db.from("expenses").select("id, title, amount, expense_date").eq("tenant_id", tenantId).eq("property_id", propertyId).eq("currency", "TRY").eq("is_sample", false).gt("amount", 0).order("expense_date", { ascending: false }).limit(60),
      db.from("property_dues").select("id, title, amount, period").eq("tenant_id", tenantId).eq("property_id", propertyId).gt("amount", 0).order("period", { ascending: false }).limit(60),
    ]);
    if (!expRes.error) {
      for (const e of (expRes.data ?? []) as { id: string; title: string; amount: number | string; expense_date: string }[]) {
        candidates.push({ kind: "expense", id: e.id, date: String(e.expense_date).slice(0, 10), label: e.title, amount: num(e.amount), linked: linkedKeys.has(`expense:${e.id}`) });
      }
    }
    if (!dueRes.error) {
      for (const d of (dueRes.data ?? []) as { id: string; title: string; amount: number | string; period: string }[]) {
        candidates.push({ kind: "due", id: d.id, date: String(d.period).slice(0, 10), label: `Aidat: ${d.title}`, amount: num(d.amount), linked: linkedKeys.has(`due:${d.id}`) });
      }
    }
  }
  return { available: true, agreement, ledger, payouts: payoutsAll, links, candidates };
}

export type OwnerBalanceRow = { rentalId: string; payable: number; balance: number };

/**
 * Yönetilen kiraların bakiyeleri (liste kartı, cron hatırlatması). `rentalIds` verilirse yalnız onlar.
 * Hata ya da şema yokken `null` (çağıran kartı gizler).
 */
export async function loadOwnerBalances(
  db: SupabaseClient,
  input: { tenantId: string; rentalIds?: readonly string[] },
): Promise<{ rows: OwnerBalanceRow[] } | null> {
  const { tenantId } = input;
  let agrQ = db.from("rental_management_agreements").select("rental_id").eq("tenant_id", tenantId).eq("managed", true);
  if (input.rentalIds) agrQ = agrQ.in("rental_id", [...input.rentalIds].slice(0, 500));
  const agr = await agrQ.limit(2000);
  if (agr.error) return null;
  const ids = ((agr.data ?? []) as { rental_id: string }[]).map((a) => a.rental_id);
  if (ids.length === 0) return { rows: [] };

  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) parts.push(ids.slice(i, i + 150));
  const payments = new Map<string, LedgerPayment[]>();
  const charges = new Map<string, LedgerCharge[]>();
  const payouts = new Map<string, LedgerPayout[]>();
  for (const part of parts) {
    const [payRes, linkRes, outRes] = await Promise.all([
      fetchAllRows<{ id: string; rental_id: string; paid_on: string; amount: number | string; management_fee: number | string | null }>((from, to) =>
        db.from("rent_payments").select("id, rental_id, paid_on, amount, management_fee").eq("tenant_id", tenantId).in("rental_id", part).is("voided_at", null).order("id", { ascending: true }).range(from, to), 1000, 20),
      fetchAllRows<{ id: string; rental_id: string; kind: LinkKind; amount: number | string; entry_date: string; label: string }>((from, to) =>
        db.from("owner_charge_links").select("id, rental_id, kind, amount, entry_date, label").eq("tenant_id", tenantId).in("rental_id", part).order("id", { ascending: true }).range(from, to), 1000, 20),
      fetchAllRows<{ id: string; rental_id: string; paid_on: string; amount: number | string }>((from, to) =>
        db.from("owner_payouts").select("id, rental_id, paid_on, amount").eq("tenant_id", tenantId).in("rental_id", part).is("voided_at", null).order("id", { ascending: true }).range(from, to), 1000, 20),
    ]);
    if (payRes.error || linkRes.error || outRes.error) return null;
    for (const p of payRes.data) {
      const list = payments.get(p.rental_id) ?? [];
      list.push({ id: p.id, paidOn: String(p.paid_on).slice(0, 10), amount: num(p.amount), managementFee: num(p.management_fee) });
      payments.set(p.rental_id, list);
    }
    for (const l of linkRes.data) {
      const list = charges.get(l.rental_id) ?? [];
      list.push({ id: l.id, kind: ledgerKind(l.kind), date: String(l.entry_date).slice(0, 10), amount: num(l.amount), label: l.label });
      charges.set(l.rental_id, list);
    }
    for (const o of outRes.data) {
      const list = payouts.get(o.rental_id) ?? [];
      list.push({ id: o.id, paidOn: String(o.paid_on).slice(0, 10), amount: num(o.amount) });
      payouts.set(o.rental_id, list);
    }
  }
  const rows = ids.map((rentalId) => {
    const l = computeOwnerLedger({ payments: payments.get(rentalId) ?? [], charges: charges.get(rentalId) ?? [], payouts: payouts.get(rentalId) ?? [] });
    return { rentalId, payable: l.payable, balance: l.totals.balance };
  });
  return { rows };
}

/** Dönem içi yönetim ücreti geliri (iptal edilmemiş tahsilatlar; `fromDay` dahil, `toDayExclusive` hariç). */
export async function loadManagementFeeIncome(
  db: SupabaseClient,
  input: { tenantId: string; fromDay: string; toDayExclusive: string },
): Promise<{ total: number; byRental: Map<string, number> } | null> {
  const res = await fetchAllRows<{ rental_id: string; management_fee: number | string }>((from, to) =>
    db.from("rent_payments").select("id, rental_id, management_fee").eq("tenant_id", input.tenantId).is("voided_at", null).gt("management_fee", 0)
      .gte("paid_on", input.fromDay).lt("paid_on", input.toDayExclusive).order("id", { ascending: true }).range(from, to), 1000, 20);
  if (res.error) return null;
  const byRental = new Map<string, number>();
  let totalK = 0;
  for (const r of res.data) {
    const k = Math.round(num(r.management_fee) * 100);
    totalK += k;
    byRental.set(r.rental_id, (byRental.get(r.rental_id) ?? 0) + k / 100);
  }
  return { total: totalK / 100, byRental };
}

export async function loadLateFeeSettings(db: SupabaseClient, tenantId: string): Promise<{ available: boolean; settings: LateFeeSettings }> {
  const res = await db.from("property_management_settings").select("late_fee_enabled, late_fee_monthly_percent, late_fee_grace_days").eq("tenant_id", tenantId).maybeSingle();
  if (res.error) return { available: false, settings: LATE_FEE_DEFAULTS };
  const row = res.data as { late_fee_enabled: boolean; late_fee_monthly_percent: number | string; late_fee_grace_days: number } | null;
  if (!row) return { available: true, settings: LATE_FEE_DEFAULTS };
  return {
    available: true,
    settings: { enabled: row.late_fee_enabled === true, monthlyPercent: num(row.late_fee_monthly_percent), graceDays: Math.trunc(num(row.late_fee_grace_days)) },
  };
}

/**
 * Kâr/zarar entegrasyonu: yönetim ücreti geliri (ay bazında) + mülk sahibine yansıtılan gider kimlikleri.
 * Yansıtılan gider ofis gideri SAYILMAZ (mülk sahibinden geri alınır); ücret ofis geliridir. Şema yoksa boş döner.
 */
export async function loadManagementPnlInputs(
  db: SupabaseClient,
  input: { tenantId: string; firstMonthKey: string },
): Promise<{ fees: { date: string; amount: number }[]; passThroughExpenseIds: Set<string> }> {
  const { tenantId, firstMonthKey } = input;
  const [feeRes, bldFeeRes, linkRes] = await Promise.all([
    fetchAllRows<{ paid_on: string; management_fee: number | string }>((from, to) =>
      db.from("rent_payments").select("id, paid_on, management_fee").eq("tenant_id", tenantId).is("voided_at", null).gt("management_fee", 0)
        .gte("paid_on", `${firstMonthKey}-01`).order("id", { ascending: true }).range(from, to), 1000, 20),
    // M2: bina aidatı tahsilatlarından alınan yönetim ücreti de ofis gelirdir (tek kalem: tahsilatın kendisi gelir SAYILMAZ, çift sayım yok).
    fetchAllRows<{ paid_on: string; management_fee: number | string }>((from, to) =>
      db.from("building_payments").select("id, paid_on, management_fee").eq("tenant_id", tenantId).is("voided_at", null).gt("management_fee", 0)
        .gte("paid_on", `${firstMonthKey}-01`).order("id", { ascending: true }).range(from, to), 1000, 20),
    fetchAllRows<{ ref_id: string }>((from, to) =>
      db.from("owner_charge_links").select("id, ref_id").eq("tenant_id", tenantId).eq("kind", "expense").order("id", { ascending: true }).range(from, to), 1000, 20),
  ]);
  return {
    fees: [
      ...(feeRes.error ? [] : feeRes.data.map((f) => ({ date: String(f.paid_on).slice(0, 10), amount: num(f.management_fee) }))),
      ...(bldFeeRes.error ? [] : bldFeeRes.data.map((f) => ({ date: String(f.paid_on).slice(0, 10), amount: num(f.management_fee) }))),
    ],
    passThroughExpenseIds: new Set(linkRes.error ? [] : linkRes.data.map((l) => l.ref_id)),
  };
}
