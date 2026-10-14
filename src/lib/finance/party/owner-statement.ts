import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { computeOwnerLedger, type LedgerCharge, type LedgerPayment, type LedgerPayout } from "@/lib/property-management/ledger";
import { fromKurus, toKurus } from "./aging";

/**
 * Malik carisi (YALNIZ GÖSTERİM): mülk yönetimi defterinden okunur, veri kopyalanmaz ve yazılmaz.
 *
 * Tek formül — FN1 `finance_open_items_v` içindeki `owner_payout` satırıyla birebir aynıdır (kira bazında):
 *   Kira bakiyesi = tahsil edilen kira − yönetim ücreti − masraf (gider + aidat) − mülk sahibine ödenen
 *   Ödenecek      = Σ max(0, kira bakiyesi)   (görünümde yalnız bakiyesi > 0 olan kira satır üretir)
 *   Fazla ödeme   = Σ max(0, −kira bakiyesi)
 *   Hak ediş      = tahsil edilen − ücret − masraf
 * Yalnız yönetim sözleşmesi `managed` olan kiralar sayılır (görünümle aynı kapsam).
 *
 * Stopaj hak edişten DÜŞÜLMEZ (görünüm de düşmez): kira tahsilatı `rent_payments`'a net/brüt nasıl girildiyse o
 * tutar esastır. `withholding` yalnız bilgi amaçlıdır: bu malik carisine (party_id) bağlı, iptal edilmemiş ofis
 * hareketlerinin `withholding_amount` toplamı (kiracı carisine bağlı tahsilatların stopajı burada görünmez).
 *
 * Bağ: cari `customer_id` → portföy `owner_customer_id` → o portföylerin kiraları. Kaynak tablolar: rent_payments,
 * owner_charge_links, owner_payouts (iptal edilenler hariç). Hesap kuruş üzerinden yapılır.
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
  /**
   * Defter satırlarından biri (tahsilat / masraf / ödeme / stopaj) üst sınıra (`OWNER_STATEMENT_MAX_ROWS`) takıldı:
   * toplamlar EKSİK olabilir; arayüz bunu açıkça söyler (sessizce tam sayılmaz).
   */
  truncated: boolean;
  totals: { collected: number; fee: number; charges: number; withholding: number; entitlement: number; paidOut: number; payable: number; overpaid: number };
};

/** Tek malik için defter tablosu başına açık üst sınır (satır); aşılırsa `truncated: true`. */
export const OWNER_STATEMENT_MAX_ROWS = 20_000;

const EMPTY_TOTALS: OwnerStatement["totals"] = { collected: 0, fee: 0, charges: 0, withholding: 0, entitlement: 0, paidOut: 0, payable: 0, overpaid: 0 };

/** SAF: kira bazındaki defter toplamlarından cari özeti (`finance_open_items_v.owner_payout` ile aynı formül). */
export function summarizeOwnerStatement(
  rentals: readonly Omit<OwnerStatementRental, "balance">[],
  withholding: number,
): Pick<OwnerStatement, "rentals" | "totals"> {
  let collected = 0;
  let fee = 0;
  let charges = 0;
  let paidOut = 0;
  let payable = 0;
  let overpaid = 0;
  const rows = rentals.map((r) => {
    const c = toKurus(r.collected);
    const f = toKurus(r.fee);
    const ch = toKurus(r.charges);
    const p = toKurus(r.paidOut);
    collected += c;
    fee += f;
    charges += ch;
    paidOut += p;
    const bal = c - f - ch - p;
    if (bal > 0) payable += bal;
    else overpaid -= bal;
    return { ...r, balance: fromKurus(bal) };
  });
  return {
    rentals: rows,
    totals: {
      collected: fromKurus(collected),
      fee: fromKurus(fee),
      charges: fromKurus(charges),
      withholding: fromKurus(Math.max(0, toKurus(withholding))),
      entitlement: fromKurus(collected - fee - charges),
      paidOut: fromKurus(paidOut),
      payable: fromKurus(payable),
      overpaid: fromKurus(overpaid),
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
  if (!customerId) return { available: false, reason: "no_customer", rentals: [], truncated: false, totals: EMPTY_TOTALS };

  const propRes = await db
    .from("properties")
    .select("id, property_code, title")
    .eq("tenant_id", tenantId)
    .eq("owner_customer_id", customerId)
    .limit(500);
  if (propRes.error) return { available: false, reason: "no_schema", rentals: [], truncated: false, totals: EMPTY_TOTALS };
  const props = (propRes.data ?? []) as { id: string; property_code: string | null; title: string | null }[];
  const propLabel = new Map(props.map((p) => [p.id, [p.property_code, p.title].filter(Boolean).join(" · ") || "Portföy"]));

  const [rentalRes, whRes] = await Promise.all([
    props.length
      ? db.from("rentals").select("id, property_id").eq("tenant_id", tenantId).in("property_id", props.map((p) => p.id)).limit(1000)
      : Promise.resolve({ data: [] as { id: string; property_id: string }[], error: null }),
    readAllPaged<{ withholding_amount: unknown }>(
      (from, to) =>
        db.from("cash_entries").select("withholding_amount").eq("tenant_id", tenantId).eq("party_id", partyId).is("voided_at", null).gt("withholding_amount", 0).order("id").range(from, to),
      { maxRows: OWNER_STATEMENT_MAX_ROWS },
    ),
  ]);
  if (rentalRes.error) return { available: false, reason: "no_schema", rentals: [], truncated: false, totals: EMPTY_TOTALS };
  // Stopaj kolonu henüz yoksa (FN1 migration'ı uygulanmadı) 0 kabul edilir; özet yine çizilir.
  const withholding = whRes.error ? 0 : whRes.rows.reduce((a, r) => a + toKurus(r.withholding_amount), 0) / 100;
  // Portföy (500) ve kira (1000) okumaları tavanlıdır; tavana değen liste de eksik sayılır.
  const whTruncated = (!whRes.error && whRes.truncated) || props.length >= 500 || (rentalRes.data ?? []).length >= 1000;

  const allRentals = (rentalRes.data ?? []) as { id: string; property_id: string }[];
  if (allRentals.length === 0) return { available: true, reason: null, truncated: whTruncated, ...summarizeOwnerStatement([], withholding) };
  // Görünümle aynı kapsam: yalnız yönetim sözleşmesi `managed` olan kiralar.
  const agrRes = await db
    .from("rental_management_agreements")
    .select("rental_id")
    .eq("tenant_id", tenantId)
    .eq("managed", true)
    .in("rental_id", allRentals.map((r) => r.id))
    .limit(1000);
  if (agrRes.error) return { available: false, reason: "no_schema", rentals: [], truncated: false, totals: EMPTY_TOTALS };
  const managed = new Set(((agrRes.data ?? []) as { rental_id: string }[]).map((a) => a.rental_id));
  const rentals = allRentals.filter((r) => managed.has(r.id));
  if (rentals.length === 0) return { available: true, reason: null, truncated: whTruncated, ...summarizeOwnerStatement([], withholding) };
  const ids = rentals.map((r) => r.id);

  const paged = { maxRows: OWNER_STATEMENT_MAX_ROWS };
  const [payRes, linkRes, outRes] = await Promise.all([
    readAllPaged<{ id: string; rental_id: string; paid_on: string; amount: unknown; management_fee: unknown }>(
      (from, to) => db.from("rent_payments").select("id, rental_id, paid_on, amount, management_fee").eq("tenant_id", tenantId).in("rental_id", ids).is("voided_at", null).order("id").range(from, to),
      paged,
    ),
    readAllPaged<{ id: string; rental_id: string; kind: string; amount: unknown; entry_date: string; label: string }>(
      (from, to) => db.from("owner_charge_links").select("id, rental_id, kind, amount, entry_date, label").eq("tenant_id", tenantId).in("rental_id", ids).order("id").range(from, to),
      paged,
    ),
    readAllPaged<{ id: string; rental_id: string; paid_on: string; amount: unknown }>(
      (from, to) => db.from("owner_payouts").select("id, rental_id, paid_on, amount").eq("tenant_id", tenantId).in("rental_id", ids).is("voided_at", null).order("id").range(from, to),
      paged,
    ),
  ]);
  if (payRes.error || linkRes.error || outRes.error) return { available: false, reason: "no_schema", rentals: [], truncated: false, totals: EMPTY_TOTALS };
  const truncated = whTruncated || managed.size >= 1000 || payRes.truncated || linkRes.truncated || outRes.truncated;

  const group = <T extends { rental_id: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.rental_id, [...(m.get(r.rental_id) ?? []), r]);
    return m;
  };
  const pays = group(payRes.rows);
  const links = group(linkRes.rows);
  const outs = group(outRes.rows);

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
  return { available: true, reason: null, truncated, ...summarizeOwnerStatement(perRental, withholding) };
}
