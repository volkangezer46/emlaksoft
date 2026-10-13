import type { SupabaseClient } from "@supabase/supabase-js";
import { computeOwnerLedger, type LedgerCharge, type LedgerPayment, type LedgerPayout } from "@/lib/property-management/ledger";
import { fromKurus, toKurus } from "./aging";

/**
 * Malik carisi (YALNIZ GÖSTERİM): mülk yönetimi defterinden okunur, veri kopyalanmaz ve yazılmaz.
 *
 *   Hak ediş = tahsil edilen kira − yönetim ücreti − masraf (gider + aidat) − stopaj
 *   Ödenecek = hak ediş − mülk sahibine yapılan ödemeler (negatifse 0; fazla ödeme ayrıca gösterilir)
 *
 * Bağ: cari `customer_id` → portföy `owner_customer_id` → o portföylerin kiraları. Stopaj, bu cariye bağlı
 * (party_id) iptal edilmemiş hareketlerin `withholding_amount` toplamıdır (kolon yoksa 0). Kaynak tablolar:
 * rent_payments, owner_charge_links, owner_payouts (mevcut; iptal edilenler hariç). Hesap kuruş üzerinden yapılır.
 */

export type OwnerStatementRental = {
  rentalId: string;
  propertyId: string;
  propertyLabel: string;
  collected: number;
  fee: number;
  charges: number;
  paidOut: number;
  balance: number;
};

export type OwnerStatement = {
  /** false: cari bir müşteri kaydına bağlı değil ya da mülk yönetimi şeması okunamadı. */
  available: boolean;
  reason: "no_customer" | "no_schema" | null;
  rentals: OwnerStatementRental[];
  totals: { collected: number; fee: number; charges: number; withholding: number; entitlement: number; paidOut: number; payable: number; overpaid: number };
};

const EMPTY_TOTALS: OwnerStatement["totals"] = { collected: 0, fee: 0, charges: 0, withholding: 0, entitlement: 0, paidOut: 0, payable: 0, overpaid: 0 };

/** SAF: kira bazındaki defter toplamlarından ve stopajdan cari özeti. */
export function summarizeOwnerStatement(
  rentals: readonly Omit<OwnerStatementRental, "balance">[],
  withholding: number,
): Pick<OwnerStatement, "rentals" | "totals"> {
  let collected = 0;
  let fee = 0;
  let charges = 0;
  let paidOut = 0;
  const rows = rentals.map((r) => {
    const c = toKurus(r.collected);
    const f = toKurus(r.fee);
    const ch = toKurus(r.charges);
    const p = toKurus(r.paidOut);
    collected += c;
    fee += f;
    charges += ch;
    paidOut += p;
    return { ...r, balance: fromKurus(c - f - ch - p) };
  });
  const w = Math.max(0, toKurus(withholding));
  const entitlement = collected - fee - charges - w;
  const remaining = entitlement - paidOut;
  return {
    rentals: rows,
    totals: {
      collected: fromKurus(collected),
      fee: fromKurus(fee),
      charges: fromKurus(charges),
      withholding: fromKurus(w),
      entitlement: fromKurus(entitlement),
      paidOut: fromKurus(paidOut),
      payable: fromKurus(Math.max(0, remaining)),
      overpaid: fromKurus(Math.max(0, -remaining)),
    },
  };
}

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Sunucu okuyucusu: çağıranın (kullanıcı oturumu, RLS) istemcisiyle çalışır; tenant süzgeci açıktır. */
export async function loadOwnerStatement(
  db: SupabaseClient,
  input: { tenantId: string; partyId: string; customerId: string | null },
): Promise<OwnerStatement> {
  const { tenantId, partyId, customerId } = input;
  if (!customerId) return { available: false, reason: "no_customer", rentals: [], totals: EMPTY_TOTALS };

  const propRes = await db
    .from("properties")
    .select("id, property_code, title")
    .eq("tenant_id", tenantId)
    .eq("owner_customer_id", customerId)
    .limit(500);
  if (propRes.error) return { available: false, reason: "no_schema", rentals: [], totals: EMPTY_TOTALS };
  const props = (propRes.data ?? []) as { id: string; property_code: string | null; title: string | null }[];
  const propLabel = new Map(props.map((p) => [p.id, [p.property_code, p.title].filter(Boolean).join(" · ") || "Portföy"]));

  const [rentalRes, whRes] = await Promise.all([
    props.length
      ? db.from("rentals").select("id, property_id").eq("tenant_id", tenantId).in("property_id", props.map((p) => p.id)).limit(1000)
      : Promise.resolve({ data: [] as { id: string; property_id: string }[], error: null }),
    db.from("cash_entries").select("withholding_amount").eq("tenant_id", tenantId).eq("party_id", partyId).is("voided_at", null).gt("withholding_amount", 0).limit(5000),
  ]);
  if (rentalRes.error) return { available: false, reason: "no_schema", rentals: [], totals: EMPTY_TOTALS };
  // Stopaj kolonu henüz yoksa (FN1 migration'ı uygulanmadı) 0 kabul edilir; özet yine çizilir.
  const withholding = whRes.error ? 0 : ((whRes.data ?? []) as { withholding_amount: unknown }[]).reduce((a, r) => a + toKurus(r.withholding_amount), 0) / 100;

  const rentals = (rentalRes.data ?? []) as { id: string; property_id: string }[];
  if (rentals.length === 0) return { available: true, reason: null, ...summarizeOwnerStatement([], withholding) };
  const ids = rentals.map((r) => r.id);

  const [payRes, linkRes, outRes] = await Promise.all([
    db.from("rent_payments").select("id, rental_id, paid_on, amount, management_fee").eq("tenant_id", tenantId).in("rental_id", ids).is("voided_at", null).limit(5000),
    db.from("owner_charge_links").select("id, rental_id, kind, amount, entry_date, label").eq("tenant_id", tenantId).in("rental_id", ids).limit(5000),
    db.from("owner_payouts").select("id, rental_id, paid_on, amount").eq("tenant_id", tenantId).in("rental_id", ids).is("voided_at", null).limit(5000),
  ]);
  if (payRes.error || linkRes.error || outRes.error) return { available: false, reason: "no_schema", rentals: [], totals: EMPTY_TOTALS };

  const group = <T extends { rental_id: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.rental_id, [...(m.get(r.rental_id) ?? []), r]);
    return m;
  };
  const pays = group((payRes.data ?? []) as { id: string; rental_id: string; paid_on: string; amount: unknown; management_fee: unknown }[]);
  const links = group((linkRes.data ?? []) as { id: string; rental_id: string; kind: string; amount: unknown; entry_date: string; label: string }[]);
  const outs = group((outRes.data ?? []) as { id: string; rental_id: string; paid_on: string; amount: unknown }[]);

  const perRental = rentals.map((r) => {
    const payments: LedgerPayment[] = (pays.get(r.id) ?? []).map((p) => ({ id: p.id, paidOn: String(p.paid_on).slice(0, 10), amount: n(p.amount), managementFee: n(p.management_fee) }));
    const charges: LedgerCharge[] = (links.get(r.id) ?? []).map((l) => ({ id: l.id, kind: l.kind === "expense" ? "expense" : "due", date: String(l.entry_date).slice(0, 10), amount: n(l.amount), label: l.label }));
    const payouts: LedgerPayout[] = (outs.get(r.id) ?? []).map((o) => ({ id: o.id, paidOn: String(o.paid_on).slice(0, 10), amount: n(o.amount) }));
    const l = computeOwnerLedger({ payments, charges, payouts });
    return {
      rentalId: r.id,
      propertyId: r.property_id,
      propertyLabel: propLabel.get(r.property_id) ?? "Portföy",
      collected: l.totals.collected,
      fee: l.totals.fee,
      charges: fromKurus(toKurus(l.totals.expenses) + toKurus(l.totals.dues)),
      paidOut: l.totals.paidOut,
    };
  });
  return { available: true, reason: null, ...summarizeOwnerStatement(perRental, withholding) };
}
