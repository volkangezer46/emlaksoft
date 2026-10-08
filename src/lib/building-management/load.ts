import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { compareUnits, unitLabel, type DistributionMethod } from "./distribution";
import { computeUnitCari, type UnitCari } from "./unit-ledger";

/**
 * Bina & site yönetimi okuyucuları. İstemci ÇAĞIRANDAN gelir (kullanıcı oturumu = RLS ya da token'lı portalın sunucu istemcisi);
 * her sorgu AÇIK tenant_id süzgeçlidir. Tablo/sütun yoksa (migration uygulanmamış) `available:false` / `null` döner, fırlatmaz.
 */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const day = (v: unknown): string => String(v).slice(0, 10);

export type BuildingRow = {
  id: string;
  name: string;
  address: string | null;
  provinceId: string | null;
  districtId: string | null;
  city: string | null;
  district: string | null;
  managedByOffice: boolean;
  feeType: "percent" | "fixed" | null;
  feeValue: number | null;
  dueDay: number;
  defaultDistribution: DistributionMethod;
  notes: string | null;
};

type RawBuilding = {
  id: string; name: string; address: string | null; province_id: string | null; district_id: string | null; city: string | null; district: string | null; managed_by_office: boolean;
  fee_type: "percent" | "fixed" | null; fee_value: number | string | null; due_day: number; default_distribution: DistributionMethod; notes: string | null;
};
const BUILDING_COLS = "id, name, address, province_id, district_id, city, district, managed_by_office, fee_type, fee_value, due_day, default_distribution, notes";

function mapBuilding(b: RawBuilding): BuildingRow {
  return {
    id: b.id, name: b.name, address: b.address, provinceId: b.province_id, districtId: b.district_id, city: b.city, district: b.district, managedByOffice: b.managed_by_office,
    feeType: b.fee_type, feeValue: b.fee_value == null ? null : num(b.fee_value), dueDay: b.due_day,
    defaultDistribution: b.default_distribution, notes: b.notes,
  };
}

export type UnitRow = {
  id: string;
  buildingId: string;
  block: string | null;
  floor: number | null;
  unitNo: string;
  label: string;
  areaM2: number | null;
  landShare: number | null;
  fixedAmount: number | null;
  ownerCustomerId: string | null;
  ownerName: string | null;
  tenantCustomerId: string | null;
  tenantName: string | null;
  rentalId: string | null;
  propertyId: string | null;
  propertyLabel: string | null;
  payer: "owner" | "tenant";
  active: boolean;
};

type RawUnit = {
  id: string; building_id: string; block: string | null; floor: number | null; unit_no: string; area_m2: number | string | null;
  land_share: number | string | null; fixed_amount: number | string | null; owner_customer_id: string | null; tenant_customer_id: string | null;
  rental_id: string | null; property_id: string | null; payer: "owner" | "tenant"; active: boolean;
  owner: { full_name: string | null } | { full_name: string | null }[] | null;
  renter: { full_name: string | null } | { full_name: string | null }[] | null;
  property: { property_code: string; title: string | null } | { property_code: string; title: string | null }[] | null;
};

const UNIT_SELECT =
  "id, building_id, block, floor, unit_no, area_m2, land_share, fixed_amount, owner_customer_id, tenant_customer_id, rental_id, property_id, payer, active, " +
  "owner:customers!building_units_owner_customer_fkey(full_name), renter:customers!building_units_tenant_customer_fkey(full_name), " +
  "property:properties!building_units_property_fkey(property_code, title)";

function mapUnit(u: RawUnit): UnitRow {
  const prop = one(u.property);
  return {
    id: u.id, buildingId: u.building_id, block: u.block, floor: u.floor, unitNo: u.unit_no, label: unitLabel({ block: u.block, unitNo: u.unit_no }),
    areaM2: u.area_m2 == null ? null : num(u.area_m2), landShare: u.land_share == null ? null : num(u.land_share),
    fixedAmount: u.fixed_amount == null ? null : num(u.fixed_amount),
    ownerCustomerId: u.owner_customer_id, ownerName: one(u.owner)?.full_name ?? null,
    tenantCustomerId: u.tenant_customer_id, tenantName: one(u.renter)?.full_name ?? null,
    rentalId: u.rental_id, propertyId: u.property_id, propertyLabel: prop ? (prop.title ?? prop.property_code) : null,
    payer: u.payer, active: u.active,
  };
}

export type ChargeRow = {
  id: string;
  batchId: string;
  buildingId: string;
  unitId: string;
  amount: number;
  paid: number;
  status: "pending" | "partial" | "paid";
  dueDate: string;
  payerRole: "owner" | "tenant";
  payerCustomerId: string | null;
  batchKind: "aidat" | "expense_share";
  batchTitle: string;
  period: string;
};

type RawCharge = {
  id: string; batch_id: string; building_id: string; unit_id: string; amount: number | string; paid_amount: number | string;
  status: "pending" | "partial" | "paid"; due_date: string; payer_role: "owner" | "tenant"; payer_customer_id: string | null;
  batch: { kind: "aidat" | "expense_share"; title: string; period: string } | { kind: "aidat" | "expense_share"; title: string; period: string }[] | null;
};
const CHARGE_SELECT =
  "id, batch_id, building_id, unit_id, amount, paid_amount, status, due_date, payer_role, payer_customer_id, batch:building_charge_batches!building_charges_batch_tenant_fkey(kind, title, period)";

function mapCharge(c: RawCharge): ChargeRow {
  const b = one(c.batch);
  return {
    id: c.id, batchId: c.batch_id, buildingId: c.building_id, unitId: c.unit_id, amount: num(c.amount), paid: num(c.paid_amount), status: c.status,
    dueDate: day(c.due_date), payerRole: c.payer_role, payerCustomerId: c.payer_customer_id,
    batchKind: b?.kind ?? "aidat", batchTitle: b?.title ?? "Aidat", period: b ? day(b.period) : day(c.due_date),
  };
}

export type PaymentRow = {
  id: string;
  chargeId: string;
  unitId: string;
  amount: number;
  paidOn: string;
  method: string;
  bankNote: string | null;
  receiptNo: number;
  managementFee: number;
  voidedAt: string | null;
  voidReason: string | null;
};
type RawPayment = {
  id: string; charge_id: string; unit_id: string; amount: number | string; paid_on: string; method: string; bank_note: string | null;
  receipt_no: number; management_fee: number | string | null; voided_at: string | null; void_reason: string | null;
};
const PAYMENT_SELECT = "id, charge_id, unit_id, amount, paid_on, method, bank_note, receipt_no, management_fee, voided_at, void_reason";
const mapPayment = (p: RawPayment): PaymentRow => ({
  id: p.id, chargeId: p.charge_id, unitId: p.unit_id, amount: num(p.amount), paidOn: day(p.paid_on), method: p.method, bankNote: p.bank_note,
  receiptNo: p.receipt_no, managementFee: num(p.management_fee), voidedAt: p.voided_at, voidReason: p.void_reason,
});

export type BatchRow = {
  id: string;
  kind: "aidat" | "expense_share";
  period: string;
  title: string;
  category: string | null;
  totalAmount: number;
  distribution: DistributionMethod;
  dueDate: string;
  voidedAt: string | null;
  voidReason: string | null;
};

// ---------------------------------------------------------------------------

export type BuildingKpi = {
  chargedMonth: number;
  collectedMonth: number;
  feeMonth: number;
  overdueCount: number;
  overdueTotal: number;
  outstandingTotal: number;
};

/** KPI RPC'si (RLS'li). RPC yoksa `null` (çağıran bölümü gizler). */
export async function loadBuildingKpi(db: SupabaseClient, monthStart?: string): Promise<BuildingKpi | null> {
  const res = await db.rpc("building_dues_kpi", monthStart ? { p_month: monthStart } : {});
  if (res.error) return null;
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as Record<string, unknown> | null;
  if (!row) return { chargedMonth: 0, collectedMonth: 0, feeMonth: 0, overdueCount: 0, overdueTotal: 0, outstandingTotal: 0 };
  return {
    chargedMonth: num(row.charged_month), collectedMonth: num(row.collected_month), feeMonth: num(row.fee_month),
    overdueCount: Math.trunc(num(row.overdue_count)), overdueTotal: num(row.overdue_total), outstandingTotal: num(row.outstanding_total),
  };
}

export type BuildingOverview = BuildingRow & {
  unitCount: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
};

export async function loadBuildingsOverview(
  db: SupabaseClient,
  input: { tenantId: string; today: string },
): Promise<{ available: boolean; buildings: BuildingOverview[] }> {
  const { tenantId, today } = input;
  const bRes = await db.from("buildings").select(BUILDING_COLS).eq("tenant_id", tenantId).is("archived_at", null).order("name", { ascending: true }).limit(500);
  if (bRes.error) return { available: false, buildings: [] };
  const buildings = ((bRes.data ?? []) as unknown as RawBuilding[]).map(mapBuilding);
  if (buildings.length === 0) return { available: true, buildings: [] };

  const [unitsRes, openRes] = await Promise.all([
    fetchAllRows<{ building_id: string }>((from, to) =>
      db.from("building_units").select("id, building_id").eq("tenant_id", tenantId).eq("active", true).order("id", { ascending: true }).range(from, to), 1000, 20),
    fetchAllRows<{ building_id: string; amount: number | string; paid_amount: number | string; due_date: string }>((from, to) =>
      db.from("building_charges").select("id, building_id, amount, paid_amount, due_date").eq("tenant_id", tenantId).neq("status", "paid").is("voided_at", null)
        .order("id", { ascending: true }).range(from, to), 1000, 30),
  ]);
  const unitCount = new Map<string, number>();
  for (const u of unitsRes.error ? [] : unitsRes.data) unitCount.set(u.building_id, (unitCount.get(u.building_id) ?? 0) + 1);
  const outstanding = new Map<string, number>();
  const overdue = new Map<string, number>();
  const overdueN = new Map<string, number>();
  for (const c of openRes.error ? [] : openRes.data) {
    const left = Math.round((num(c.amount) - num(c.paid_amount)) * 100);
    outstanding.set(c.building_id, (outstanding.get(c.building_id) ?? 0) + left);
    if (day(c.due_date) < today) {
      overdue.set(c.building_id, (overdue.get(c.building_id) ?? 0) + left);
      overdueN.set(c.building_id, (overdueN.get(c.building_id) ?? 0) + 1);
    }
  }
  return {
    available: true,
    buildings: buildings.map((b) => ({
      ...b,
      unitCount: unitCount.get(b.id) ?? 0,
      outstanding: (outstanding.get(b.id) ?? 0) / 100,
      overdueAmount: (overdue.get(b.id) ?? 0) / 100,
      overdueCount: overdueN.get(b.id) ?? 0,
    })),
  };
}

export type BuildingDetail = {
  building: BuildingRow;
  units: UnitRow[];
  batches: BatchRow[];
  charges: ChargeRow[];
  payments: PaymentRow[];
};

export async function loadBuildingDetail(
  db: SupabaseClient,
  input: { tenantId: string; buildingId: string },
): Promise<BuildingDetail | null> {
  const { tenantId, buildingId } = input;
  const bRes = await db.from("buildings").select(BUILDING_COLS).eq("tenant_id", tenantId).eq("id", buildingId).is("archived_at", null).maybeSingle();
  if (bRes.error || !bRes.data) return null;
  const [uRes, batchRes, chargeRes, payRes] = await Promise.all([
    fetchAllRows<RawUnit>((from, to) =>
      db.from("building_units").select(UNIT_SELECT).eq("tenant_id", tenantId).eq("building_id", buildingId).order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: RawUnit[] | null; error: { message: string } | null }>, 1000, 10),
    db.from("building_charge_batches").select("id, kind, period, title, category, total_amount, distribution, due_date, voided_at, void_reason")
      .eq("tenant_id", tenantId).eq("building_id", buildingId).order("period", { ascending: false }).order("created_at", { ascending: false }).limit(60),
    db.from("building_charges").select(CHARGE_SELECT).eq("tenant_id", tenantId).eq("building_id", buildingId).is("voided_at", null)
      .order("due_date", { ascending: false }).order("id", { ascending: true }).limit(3000),
    db.from("building_payments").select(PAYMENT_SELECT).eq("tenant_id", tenantId).eq("building_id", buildingId)
      .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
  ]);
  if (uRes.error || batchRes.error || chargeRes.error || payRes.error) return null;
  const units = uRes.data.map(mapUnit).sort((a, b) => compareUnits({ block: a.block, floor: a.floor, unitNo: a.unitNo, id: a.id }, { block: b.block, floor: b.floor, unitNo: b.unitNo, id: b.id }));
  const batches: BatchRow[] = ((batchRes.data ?? []) as unknown as { id: string; kind: "aidat" | "expense_share"; period: string; title: string; category: string | null; total_amount: number | string; distribution: DistributionMethod; due_date: string; voided_at: string | null; void_reason: string | null }[]).map((x) => ({
    id: x.id, kind: x.kind, period: day(x.period), title: x.title, category: x.category, totalAmount: num(x.total_amount), distribution: x.distribution,
    dueDate: day(x.due_date), voidedAt: x.voided_at, voidReason: x.void_reason,
  }));
  return {
    building: mapBuilding(bRes.data as unknown as RawBuilding),
    units,
    batches,
    charges: ((chargeRes.data ?? []) as unknown as RawCharge[]).map(mapCharge),
    payments: ((payRes.data ?? []) as unknown as RawPayment[]).map(mapPayment),
  };
}

export type UnitCariData = {
  unit: UnitRow;
  building: { id: string; name: string };
  cari: UnitCari;
  charges: ChargeRow[];
  payments: PaymentRow[];
};

/** Daire cari verisi: iptal edilmemiş tahakkuk + tahsilatlar. */
export async function loadUnitCari(db: SupabaseClient, input: { tenantId: string; unitId: string }): Promise<UnitCariData | null> {
  const { tenantId, unitId } = input;
  const uRes = await db.from("building_units").select(`${UNIT_SELECT}, building:buildings!building_units_building_tenant_fkey(id, name)`).eq("tenant_id", tenantId).eq("id", unitId).maybeSingle();
  if (uRes.error || !uRes.data) return null;
  const raw = uRes.data as unknown as RawUnit & { building: { id: string; name: string } | { id: string; name: string }[] | null };
  const [chRes, payRes] = await Promise.all([
    db.from("building_charges").select(CHARGE_SELECT).eq("tenant_id", tenantId).eq("unit_id", unitId).is("voided_at", null).order("due_date", { ascending: true }).limit(2000),
    db.from("building_payments").select(PAYMENT_SELECT).eq("tenant_id", tenantId).eq("unit_id", unitId).order("paid_on", { ascending: true }).limit(2000),
  ]);
  if (chRes.error || payRes.error) return null;
  const charges = ((chRes.data ?? []) as unknown as RawCharge[]).map(mapCharge);
  const payments = ((payRes.data ?? []) as unknown as RawPayment[]).map(mapPayment);
  const cari = buildCari(charges, payments);
  const b = one(raw.building);
  return { unit: mapUnit(raw), building: { id: b?.id ?? raw.building_id, name: b?.name ?? "Bina" }, cari, charges, payments };
}

export function buildCari(charges: readonly ChargeRow[], payments: readonly PaymentRow[]): UnitCari {
  return computeUnitCari({
    charges: charges.map((c) => ({ id: c.id, date: c.period > c.dueDate ? c.dueDate : c.period, amount: c.amount, label: `${c.batchTitle} (vade ${c.dueDate})` })),
    payments: payments.filter((p) => !p.voidedAt).map((p) => ({ id: p.id, date: p.paidOn, amount: p.amount, label: "Tahsilat", receiptNo: p.receiptNo })),
  });
}

/** `YYYY-MM` → sonraki ayın ilk günü (`YYYY-MM-01`). */
export function nextMonthFirst(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
}

/** Genel sekme listesi: bina aidatları (durum/dönem süzgeci + gerçek sayfalama). */
export async function loadBuildingChargesPage(
  db: SupabaseClient,
  input: { tenantId: string; today: string; durum: "" | "paid" | "unpaid" | "overdue"; donem: string; offset: number; limit: number },
): Promise<{ rows: (ChargeRow & { buildingName: string; unitLabel: string })[]; count: number } | null> {
  let q = db
    .from("building_charges")
    .select(`${CHARGE_SELECT}, building:buildings!building_charges_building_tenant_fkey(name), unit:building_units!building_charges_unit_tenant_fkey(block, unit_no)`, { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .is("voided_at", null);
  if (input.donem) q = q.gte("due_date", `${input.donem}-01`).lt("due_date", nextMonthFirst(input.donem));
  if (input.durum === "paid") q = q.eq("status", "paid");
  else if (input.durum === "unpaid") q = q.neq("status", "paid");
  else if (input.durum === "overdue") q = q.neq("status", "paid").lt("due_date", input.today);
  q = q.order("due_date", { ascending: false }).order("id", { ascending: true }).range(input.offset, input.offset + input.limit - 1);
  const res = await q;
  if (res.error) return null;
  const rows = ((res.data ?? []) as unknown as (RawCharge & {
    building: { name: string } | { name: string }[] | null;
    unit: { block: string | null; unit_no: string } | { block: string | null; unit_no: string }[] | null;
  })[]).map((r) => {
    const u = one(r.unit);
    return { ...mapCharge(r), buildingName: one(r.building)?.name ?? "Bina", unitLabel: u ? unitLabel({ block: u.block, unitNo: u.unit_no }) : "Daire" };
  });
  return { rows, count: res.count ?? rows.length };
}

/** Tenant seçimi için: etkin binalar (ad). */
export async function loadBuildingOptions(db: SupabaseClient, tenantId: string): Promise<{ id: string; name: string }[]> {
  const res = await db.from("buildings").select("id, name").eq("tenant_id", tenantId).is("archived_at", null).order("name", { ascending: true }).limit(500);
  return res.error ? [] : ((res.data ?? []) as { id: string; name: string }[]);
}

/** Tüm daireler (cari sekmesi seçimi): yalnız etiket. */
export async function loadUnitOptions(db: SupabaseClient, tenantId: string, buildingId?: string): Promise<{ id: string; buildingId: string; buildingName: string; label: string }[]> {
  let q = db
    .from("building_units")
    .select("id, building_id, block, unit_no, building:buildings!building_units_building_tenant_fkey(name)")
    .eq("tenant_id", tenantId)
    .order("building_id", { ascending: true })
    .order("unit_no", { ascending: true })
    .limit(3000);
  if (buildingId) q = q.eq("building_id", buildingId);
  const res = await q;
  if (res.error) return [];
  return ((res.data ?? []) as unknown as { id: string; building_id: string; block: string | null; unit_no: string; building: { name: string } | { name: string }[] | null }[]).map((u) => ({
    id: u.id, buildingId: u.building_id, buildingName: one(u.building)?.name ?? "Bina", label: unitLabel({ block: u.block, unitNo: u.unit_no }),
  }));
}

/**
 * Portal (salt-okunur) okuyucu: bir müşterinin (malik/kiracı) ödeyen olduğu daire tahakkukları + ödemeleri.
 * İstemci token'ı doğrulayan sayfadan gelir; sorgu AÇIK tenant + müşteri kapsamlıdır. Başka dairenin verisi sızmaz.
 */
export type PortalUnitDues = {
  unitId: string;
  title: string;
  balance: number;
  charges: { id: string; title: string; dueDate: string; amount: number; paid: number; status: "pending" | "partial" | "paid" }[];
  payments: { id: string; paidOn: string; amount: number; method: string }[];
};

export async function loadPortalCustomerDues(
  db: SupabaseClient,
  input: { tenantId: string; role: "owner" | "tenant"; customerId?: string; propertyId?: string },
): Promise<PortalUnitDues[] | null> {
  const { tenantId } = input;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((input.customerId && !UUID.test(input.customerId)) || (input.propertyId && !UUID.test(input.propertyId))) return [];
  let uq = db
    .from("building_units")
    .select("id, block, unit_no, owner_customer_id, tenant_customer_id, payer, building:buildings!building_units_building_tenant_fkey(name)")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (input.customerId) uq = uq.eq(input.role === "owner" ? "owner_customer_id" : "tenant_customer_id", input.customerId);
  else if (input.propertyId) uq = uq.eq("property_id", input.propertyId);
  else return [];
  const uRes = await uq.limit(50);
  if (uRes.error) return null;
  const units = (uRes.data ?? []) as unknown as { id: string; block: string | null; unit_no: string; building: { name: string } | { name: string }[] | null }[];
  if (units.length === 0) return [];
  const ids = units.map((u) => u.id);
  const [chRes, payRes] = await Promise.all([
    db.from("building_charges").select(CHARGE_SELECT).eq("tenant_id", tenantId).in("unit_id", ids).is("voided_at", null).order("due_date", { ascending: false }).limit(1000),
    db.from("building_payments").select(PAYMENT_SELECT).eq("tenant_id", tenantId).in("unit_id", ids).is("voided_at", null).order("paid_on", { ascending: false }).limit(1000),
  ]);
  if (chRes.error || payRes.error) return null;
  // Yalnız izleyenin ÖDEYEN olduğu tahakkuklar (malik portalı malik borcunu, kiracı portalı kiracı borcunu görür).
  const charges = ((chRes.data ?? []) as unknown as RawCharge[]).map(mapCharge).filter((c) => c.payerRole === input.role);
  const ownCharge = new Set(charges.map((c) => c.id));
  const payments = ((payRes.data ?? []) as unknown as RawPayment[]).map(mapPayment).filter((p) => ownCharge.has(p.chargeId));
  return units.map((u) => {
    const mine = charges.filter((c) => c.unitId === u.id);
    const pays = payments.filter((p) => p.unitId === u.id);
    const cari = buildCari(mine, pays);
    return {
      unitId: u.id,
      title: `${one(u.building)?.name ?? "Bina"} · ${unitLabel({ block: u.block, unitNo: u.unit_no })}`,
      balance: cari.totals.balance,
      charges: mine.slice(0, 24).map((c) => ({ id: c.id, title: c.batchTitle, dueDate: c.dueDate, amount: c.amount, paid: c.paid, status: c.status })),
      payments: pays.slice(0, 24).map((p) => ({ id: p.id, paidOn: p.paidOn, amount: p.amount, method: p.method })),
    };
  });
}
