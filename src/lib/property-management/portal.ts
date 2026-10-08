import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeOwnerLedger, feeDescription, type LedgerCharge, type LedgerPayment, type LedgerPayout, type OwnerLedger } from "./ledger";
import type { FeeType } from "./payments";

/**
 * Malik portalı hakediş ekstresi okuyucusu. İstemci, token'ı ve modül kapısını doğrulayan malik paneli sayfasından gelir;
 * her sorgu AÇIK tenant_id + portföy kapsamlıdır. Mülk sahibine YALNIZ kendi mülkünün hakediş satırları, ödemeleri ve ücret
 * özeti gider; IBAN, danışman notu, kiracı bilgisi ve makbuz ayrıntısı GİTMEZ. Yönetilen kira yoksa `null` (bölüm gizlenir).
 */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type PortalOwnerStatement = {
  ledger: OwnerLedger;
  feeText: string;
  payoutDay: number;
  payouts: { id: string; paidOn: string; amount: number; method: string; reference: string | null }[];
};

export async function loadPortalOwnerStatement(
  db: SupabaseClient,
  input: { tenantId: string; propertyId: string },
): Promise<PortalOwnerStatement | null> {
  const { tenantId, propertyId } = input;
  const rentals = await db.from("rentals").select("id").eq("tenant_id", tenantId).eq("property_id", propertyId).limit(100);
  if (rentals.error) return null;
  const rentalIds = ((rentals.data ?? []) as { id: string }[]).map((r) => r.id);
  if (rentalIds.length === 0) return null;
  const agr = await db
    .from("rental_management_agreements")
    .select("rental_id, fee_type, fee_value, payout_day, created_at")
    .eq("tenant_id", tenantId)
    .eq("managed", true)
    .in("rental_id", rentalIds)
    .order("created_at", { ascending: false })
    .limit(100);
  if (agr.error) return null;
  const agreements = (agr.data ?? []) as { rental_id: string; fee_type: FeeType; fee_value: number | string; payout_day: number }[];
  if (agreements.length === 0) return null;
  const managedIds = agreements.map((a) => a.rental_id);

  const [pay, links, outs] = await Promise.all([
    db.from("rent_payments").select("id, paid_on, amount, management_fee").eq("tenant_id", tenantId).in("rental_id", managedIds).is("voided_at", null).limit(5000),
    db.from("owner_charge_links").select("id, kind, amount, entry_date, label").eq("tenant_id", tenantId).in("rental_id", managedIds).limit(2000),
    db.from("owner_payouts").select("id, paid_on, amount, method, reference").eq("tenant_id", tenantId).in("rental_id", managedIds).is("voided_at", null).order("paid_on", { ascending: false }).limit(500),
  ]);
  if (pay.error || links.error || outs.error) return null;

  const payments: LedgerPayment[] = ((pay.data ?? []) as { id: string; paid_on: string; amount: number | string; management_fee: number | string | null }[]).map((p) => ({
    id: p.id, paidOn: String(p.paid_on).slice(0, 10), amount: num(p.amount), managementFee: num(p.management_fee),
  }));
  const charges: LedgerCharge[] = ((links.data ?? []) as { id: string; kind: "expense" | "due" | "unit_charge"; amount: number | string; entry_date: string; label: string }[]).map((l) => ({
    id: l.id, kind: l.kind === "expense" ? ("expense" as const) : ("due" as const), date: String(l.entry_date).slice(0, 10), amount: num(l.amount), label: l.label,
  }));
  const payoutRows = ((outs.data ?? []) as { id: string; paid_on: string; amount: number | string; method: string; reference: string | null }[]).map((o) => ({
    id: o.id, paidOn: String(o.paid_on).slice(0, 10), amount: num(o.amount), method: o.method, reference: o.reference,
  }));
  const payouts: LedgerPayout[] = payoutRows.map((o) => ({ id: o.id, paidOn: o.paidOn, amount: o.amount, reference: o.reference }));
  const latest = agreements[0]!;
  return {
    ledger: computeOwnerLedger({ payments, charges, payouts }),
    feeText: feeDescription(latest.fee_type, num(latest.fee_value)),
    payoutDay: latest.payout_day,
    payouts: payoutRows,
  };
}
