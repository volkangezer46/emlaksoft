"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate } from "@/lib/workflow-state";
import { now, trDayKey } from "@/lib/clock";
import { revalidateTenantData } from "@/lib/revalidate";
import { formatTryDecimal } from "@/lib/format";
import { validateTenantReferences } from "@/lib/tenant-references";
import { resolveChainForSave } from "@/lib/geo";
import { isPaymentMethod } from "@/lib/property-management/payments";
import { buildingDueDate, periodStart } from "@/lib/building-management/charges";
import { compareUnits, distributeAmount, isDistributionMethod, unitLabel } from "@/lib/building-management/distribution";
import { isUuid, parseBuildingInput, parseUnitInput, parseUnitRange } from "@/lib/building-management/input";
import { recordCollectionCash, voidCollectionCash } from "@/lib/finance/cash/collection-link";

/**
 * Bina & site yönetimi (M2) server action'ları. Tümü `expenses` modülü (Aidat sayfasının modülü) kapısındadır;
 * yazma yolları tahakkuk/tahsilat için veritabanı RPC'leridir (tutar/tahakkuk kilidi, makbuz sırası, denetim kaydı tek transaction)
 * ve JWT kimliğiyle çalışır — service_role YOK. Yetki: oluşturma = create, tahsilat/düzenleme = edit, iptal/arşiv = delete;
 * malik aidat borcunu kira hakedişinden mahsup etmek ayrıca `rentals:edit` ister.
 */

export type BmResult = { ok?: boolean; error?: string; id?: string; receiptNo?: number; count?: number; info?: string };

const MISSING_MSG = "Bina yönetimi için veritabanı güncellemesi henüz uygulanmamış.";
const PATHS = ["/app/aidat", "/app/raporlar/kar-zarar"] as const;

function isMissingSchema(e: { code?: string | null; message?: string | null } | null): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  return code === "42P01" || code === "42883" || code === "42703" || code === "PGRST202" || code === "PGRST204" || code === "PGRST205" ||
    /does not exist|schema cache|could not find/i.test(String(e.message ?? ""));
}

const money = (n: number) => formatTryDecimal(n, 2);

function outcomeError(outcome: string, extra?: { remaining?: number; sum?: number }): string {
  switch (outcome) {
    case "unauthorized": return "Oturum bulunamadı. Yeniden giriş yapın.";
    case "forbidden": return "Bu işlem için yetkiniz yok.";
    case "invalid_input": return "Girdiğiniz bilgileri kontrol edin (tutar, tarih ve yöntem).";
    case "invalid_shares": return "Dağıtılan daireler geçersiz. Sayfayı yenileyip daire listesini kontrol edin.";
    case "sum_mismatch": return "Daire paylarının toplamı girilen tutarla eşleşmiyor. Sayfayı yenileyip tekrar deneyin.";
    case "duplicate_period": return "Bu bina için bu dönemin aidat tahakkuku zaten var.";
    case "has_payments": return "Bu tahakkukta tahsilat var; önce tahsilatları iptal edin.";
    case "not_found": return "Kayıt bulunamadı.";
    case "already_paid": return "Bu tahakkuk zaten tamamen ödenmiş.";
    case "overpayment": return `Tutar kalan borcu${extra?.remaining != null ? ` (${money(extra.remaining)})` : ""} aşıyor.`;
    case "already_voided": return "Bu kayıt zaten iptal edilmiş.";
    case "payer_not_owner": return "Bu tahakkukun ödeyeni malik değil; yalnız malik borcu hakedişten mahsup edilir.";
    case "not_managed": return "Dairenin bağlı kirası için yönetim sözleşmesi etkin değil; mahsup yapılamaz.";
    default: return "İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.";
  }
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Bina
// ---------------------------------------------------------------------------

/** İl/ilçe kimliklerini coğrafya servisiyle doğrular; kayıtta kimlik + görünen ad birlikte saklanır (tek merkez: lib/geo). */
async function resolveBuildingGeo(
  provinceId: string | null,
  districtId: string | null,
): Promise<{ error: string } | { province_id: string | null; district_id: string | null; city: string | null; district: string | null }> {
  if (!provinceId) return { province_id: null, district_id: null, city: null, district: null };
  const r = await resolveChainForSave({ province_id: provinceId, district_id: districtId });
  if ("error" in r) return { error: r.error };
  return { province_id: r.geo.provinceId, district_id: r.geo.districtId, city: r.geo.provinceName, district: r.geo.districtName };
}

export async function createBuilding(input: Record<string, unknown>): Promise<BmResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  const parsed = parseBuildingInput(input);
  if (!parsed.ok) return { error: parsed.error };
  const b = parsed.value;
  const geo = await resolveBuildingGeo(b.provinceId, b.districtId);
  if ("error" in geo) return { error: geo.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .insert({
      tenant_id: gate.tenantId, created_by: gate.userId, name: b.name, address: b.address, ...geo,
      managed_by_office: b.managedByOffice, fee_type: b.feeType, fee_value: b.feeValue, due_day: b.dueDay,
      default_distribution: b.defaultDistribution, notes: b.notes,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("createBuilding", { code: error?.code });
    return { error: actionErrorMessage(error, "Bina kaydedilemedi") };
  }
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: data.id as string };
}

export async function updateBuilding(id: string, input: Record<string, unknown>): Promise<BmResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id)) return { error: "Bina bulunamadı." };
  const parsed = parseBuildingInput(input);
  if (!parsed.ok) return { error: parsed.error };
  const b = parsed.value;
  const geo = await resolveBuildingGeo(b.provinceId, b.districtId);
  if ("error" in geo) return { error: geo.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .update({
      name: b.name, address: b.address, ...geo, managed_by_office: b.managedByOffice, fee_type: b.feeType,
      fee_value: b.feeValue, due_day: b.dueDay, default_distribution: b.defaultDistribution, notes: b.notes, updated_at: new Date(now()).toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("updateBuilding", { code: error.code });
    return { error: actionErrorMessage(error, "Bina güncellenemedi") };
  }
  if (!data) return { error: "Bina bulunamadı." };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id };
}

/** Binayı arşivle (silinmez): açık borç varsa engellenir. */
export async function archiveBuilding(id: string): Promise<BmResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id)) return { error: "Bina bulunamadı." };
  const supabase = await createClient();
  const open = await supabase.from("building_charges").select("id", { count: "exact", head: true }).eq("tenant_id", gate.tenantId).eq("building_id", id).neq("status", "paid").is("voided_at", null);
  if (open.error) {
    if (isMissingSchema(open.error)) return { error: MISSING_MSG };
    return { error: actionErrorMessage(open.error, "Bina arşivlenemedi") };
  }
  if ((open.count ?? 0) > 0) return { error: `Binada ödenmemiş ${open.count} tahakkuk var; önce tahsil edin ya da iptal edin.` };
  const { data, error } = await supabase
    .from("buildings")
    .update({ archived_at: new Date(now()).toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Bina arşivlenemedi") };
  if (!data) return { error: "Bina bulunamadı." };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Daire
// ---------------------------------------------------------------------------

async function checkUnitReferences(tenantId: string, u: { ownerCustomerId: string | null; tenantCustomerId: string | null; rentalId: string | null; propertyId: string | null }): Promise<string | null> {
  for (const customerId of [u.ownerCustomerId, u.tenantCustomerId]) {
    if (!customerId) continue;
    const r = await validateTenantReferences(tenantId, { customerId });
    if (!r.ok) return r.error;
  }
  if (u.propertyId) {
    const r = await validateTenantReferences(tenantId, { propertyId: u.propertyId });
    if (!r.ok) return r.error;
  }
  if (u.rentalId) {
    const supabase = await createClient();
    const { data } = await supabase.from("rentals").select("id").eq("id", u.rentalId).eq("tenant_id", tenantId).maybeSingle();
    if (!data) return "Seçilen kira kaydı bulunamadı.";
  }
  return null;
}

export async function saveBuildingUnit(input: Record<string, unknown> & { buildingId: string; id?: string }): Promise<BmResult> {
  const gate = await requirePermission("expenses", input.id ? "edit" : "create");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.buildingId)) return { error: "Bina bulunamadı." };
  if (input.id && !isUuid(input.id)) return { error: "Daire bulunamadı." };
  const parsed = parseUnitInput(input);
  if (!parsed.ok) return { error: parsed.error };
  const u = parsed.value;
  const refError = await checkUnitReferences(gate.tenantId, u);
  if (refError) return { error: refError };

  const row = {
    block: u.block, floor: u.floor, unit_no: u.unitNo, area_m2: u.areaM2, land_share: u.landShare, fixed_amount: u.fixedAmount,
    owner_customer_id: u.ownerCustomerId, tenant_customer_id: u.tenantCustomerId, rental_id: u.rentalId, property_id: u.propertyId,
    payer: u.payer, notes: u.notes,
  };
  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("building_units")
      .update({ ...row, updated_at: new Date(now()).toISOString() })
      .eq("id", input.id)
      .eq("tenant_id", gate.tenantId)
      .eq("building_id", input.buildingId)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isMissingSchema(error)) return { error: MISSING_MSG };
      console.error("saveBuildingUnit.update", { code: error.code });
      return { error: actionErrorMessage(error, "Daire güncellenemedi") };
    }
    if (!data) return { error: "Daire bulunamadı." };
    revalidateTenantData(gate.tenantId, PATHS);
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase
    .from("building_units")
    .insert({ ...row, tenant_id: gate.tenantId, building_id: input.buildingId, created_by: gate.userId })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    if (error?.code === "23505") return { error: "Bu blokta aynı numaralı bir daire zaten var." };
    console.error("saveBuildingUnit.insert", { code: error?.code });
    return { error: actionErrorMessage(error, "Daire kaydedilemedi") };
  }
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: data.id as string };
}

/** Numara aralığından toplu daire ekle (ör. 1-12). Var olan numaralar atlanır. */
export async function createUnitsBulk(input: { buildingId: string; from: number | string; to: number | string; block?: string }): Promise<BmResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.buildingId)) return { error: "Bina bulunamadı." };
  const range = parseUnitRange(input);
  if (!range.ok) return { error: range.error };
  const supabase = await createClient();
  const { data: building } = await supabase.from("buildings").select("id").eq("id", input.buildingId).eq("tenant_id", gate.tenantId).is("archived_at", null).maybeSingle();
  if (!building) return { error: "Bina bulunamadı." };
  // Benzersiz indeks ifadeli (coalesce(block,'')) olduğundan upsert yerine: var olan numaraları oku, yalnız eksikleri ekle.
  const existingRes = await supabase.from("building_units").select("unit_no, block").eq("tenant_id", gate.tenantId).eq("building_id", input.buildingId).limit(3000);
  if (existingRes.error) {
    if (isMissingSchema(existingRes.error)) return { error: MISSING_MSG };
    return { error: actionErrorMessage(existingRes.error, "Daireler eklenemedi") };
  }
  const taken = new Set(((existingRes.data ?? []) as { unit_no: string; block: string | null }[]).filter((u) => (u.block ?? "") === (range.block ?? "")).map((u) => u.unit_no));
  const fresh = range.numbers.filter((n) => !taken.has(n));
  if (fresh.length === 0) return { ok: true, count: 0, info: "Aralıktaki tüm daireler zaten kayıtlı." };
  const { data, error } = await supabase
    .from("building_units")
    .insert(fresh.map((n) => ({ tenant_id: gate.tenantId, building_id: input.buildingId, block: range.block, unit_no: n, created_by: gate.userId })))
    .select("id");
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("createUnitsBulk", { code: error.code });
    return { error: actionErrorMessage(error, "Daireler eklenemedi") };
  }
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, count: (data ?? []).length };
}

/** Daireyi pasifleştir (silinmez; yeni tahakkuklara girmez, geçmiş cari korunur) ya da yeniden etkinleştir. */
export async function setUnitActive(id: string, active: boolean): Promise<BmResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id)) return { error: "Daire bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("building_units").update({ active, updated_at: new Date(now()).toISOString() }).eq("id", id).eq("tenant_id", gate.tenantId).select("id").maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Daire güncellenemedi") };
  if (!data) return { error: "Daire bulunamadı." };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tahakkuk: dönem aidatı + ortak gider paylaştırma
// ---------------------------------------------------------------------------

type BatchInput = {
  buildingId: string;
  kind: "aidat" | "expense_share";
  /** `YYYY-MM` */
  month: string;
  title: string;
  category?: string;
  total?: string | number | null;
  method: string;
  dueDate?: string;
};

async function createBatch(tenantId: string, input: BatchInput): Promise<BmResult> {
  if (!isUuid(input.buildingId)) return { error: "Bina bulunamadı." };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) return { error: "Geçerli bir dönem (ay) seçin." };
  if (!isDistributionMethod(input.method)) return { error: "Dağıtım yöntemini seçin." };
  const title = input.title.trim();
  if (title.length < 1 || title.length > 160) return { error: "Başlık 1-160 karakter olmalı." };
  const category = (input.category ?? "").trim();
  if (category.length > 60) return { error: "Kategori en fazla 60 karakter olabilir." };
  let totalIn: number | null = null;
  if (!(input.method === "fixed" && (input.total == null || String(input.total).trim() === ""))) {
    const m = parseMoneyInput(input.total, { max: 1_000_000_000 });
    if (!m.ok || m.value == null || m.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
    totalIn = m.value;
  }

  const supabase = await createClient();
  const { data: building, error: bErr } = await supabase
    .from("buildings")
    .select("id, due_day")
    .eq("id", input.buildingId)
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .maybeSingle();
  if (bErr) {
    if (isMissingSchema(bErr)) return { error: MISSING_MSG };
    return { error: actionErrorMessage(bErr, "Tahakkuk oluşturulamadı") };
  }
  if (!building) return { error: "Bina bulunamadı." };

  const period = periodStart(input.month);
  let dueDate = (input.dueDate ?? "").trim();
  if (!dueDate) dueDate = buildingDueDate(period, Number((building as { due_day: number }).due_day));
  if (!isIsoDate(dueDate)) return { error: "Geçerli bir son ödeme tarihi girin." };

  const { data: unitRows, error: uErr } = await supabase
    .from("building_units")
    .select("id, block, floor, unit_no, area_m2, land_share, fixed_amount")
    .eq("tenant_id", tenantId)
    .eq("building_id", input.buildingId)
    .eq("active", true)
    .limit(2000);
  if (uErr) return { error: actionErrorMessage(uErr, "Tahakkuk oluşturulamadı") };
  const units = ((unitRows ?? []) as { id: string; block: string | null; floor: number | null; unit_no: string; area_m2: number | string | null; land_share: number | string | null; fixed_amount: number | string | null }[])
    .map((u) => ({ id: u.id, block: u.block, floor: u.floor, unitNo: u.unit_no, areaM2: u.area_m2 == null ? null : Number(u.area_m2), landShare: u.land_share == null ? null : Number(u.land_share), fixedAmount: u.fixed_amount == null ? null : Number(u.fixed_amount) }))
    .sort(compareUnits);
  if (units.length === 0) return { error: "Binada etkin daire yok. Önce daireleri ekleyin." };

  const dist = distributeAmount({
    method: input.method,
    total: totalIn,
    units: units.map((u) => ({ id: u.id, label: unitLabel(u), areaM2: u.areaM2, landShare: u.landShare, fixedAmount: u.fixedAmount })),
  });
  if (!dist.ok) return { error: dist.error };

  const { data, error } = await supabase.rpc("create_building_batch", {
    p_building_id: input.buildingId,
    p_kind: input.kind,
    p_period: period,
    p_title: title,
    p_category: category || null,
    p_total: dist.total,
    p_distribution: input.method,
    p_due_date: dueDate,
    p_shares: dist.shares.map((s) => ({ unit_id: s.unitId, amount: s.amount })),
  });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("createBatch", { code: error.code });
    return { error: actionErrorMessage(error, "Tahakkuk oluşturulamadı") };
  }
  const res = asObject(data);
  const outcome = typeof res.outcome === "string" ? res.outcome : "invalid_result";
  if (outcome !== "created") return { error: outcomeError(outcome, { sum: typeof res.sum === "number" ? res.sum : undefined }) };
  revalidateTenantData(tenantId, PATHS);
  return { ok: true, id: String(res.batch_id ?? ""), count: Number(res.charge_count) || units.length, info: `${units.length} daireye ${money(dist.total)} dağıtıldı` };
}

/** Dönem (ay) aidat tahakkuku: tüm etkin dairelere seçilen yönteme göre toplu borç. */
export async function createAidatBatch(input: Omit<BatchInput, "kind">): Promise<BmResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  return createBatch(gate.tenantId, { ...input, kind: "aidat" });
}

/** Bina gideri (asansör, temizlik, elektrik, bakım...) girip dairelere paylaştır; her daireye borç olarak tahakkuk eder. */
export async function createExpenseShare(input: Omit<BatchInput, "kind">): Promise<BmResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  return createBatch(gate.tenantId, { ...input, kind: "expense_share" });
}

export async function voidBuildingBatch(input: { batchId: string; reason: string }): Promise<BmResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.batchId)) return { error: "Tahakkuk bulunamadı." };
  const reason = input.reason.trim();
  if (reason.length < 3) return { error: "İptal nedenini yazın (en az 3 karakter)." };
  if (reason.length > 300) return { error: "İptal nedeni en fazla 300 karakter olabilir." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_building_batch", { p_batch_id: input.batchId, p_reason: reason });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("voidBuildingBatch", { code: error.code });
    return { error: actionErrorMessage(error, "Tahakkuk iptal edilemedi") };
  }
  const outcome = typeof asObject(data).outcome === "string" ? String(asObject(data).outcome) : "invalid_result";
  if (outcome !== "voided") return { error: outcomeError(outcome) };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tahsilat
// ---------------------------------------------------------------------------

/** Daire tahakkukuna tahsilat (kısmi ödeme dahil): makbuz no kira ile aynı ofis sayacından, durum ödenen toplamdan türer. */
export async function recordBuildingPayment(input: {
  chargeId: string;
  amount: string | number;
  paidOn: string;
  method: string;
  bankNote?: string;
  accountId?: string | null;
}): Promise<BmResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.chargeId)) return { error: "Tahakkuk bulunamadı." };
  const amount = parseMoneyInput(input.amount, { max: 1_000_000_000 });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  if (!isIsoDate(input.paidOn)) return { error: "Geçerli bir tahsilat tarihi girin." };
  if (input.paidOn > trDayKey(now())) return { error: "Tahsilat tarihi gelecekte olamaz." };
  if (!isPaymentMethod(input.method)) return { error: "Ödeme yöntemini seçin." };
  const note = (input.bankNote ?? "").trim();
  if (note.length > 300) return { error: "Banka / açıklama en fazla 300 karakter olabilir." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_building_payment", {
    p_charge_id: input.chargeId,
    p_amount: amount.value,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_bank_note: note || null,
  });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("recordBuildingPayment", { code: error.code });
    return { error: actionErrorMessage(error, "Tahsilat kaydedilemedi") };
  }
  const res = asObject(data);
  const outcome = typeof res.outcome === "string" ? res.outcome : "invalid_result";
  if (outcome !== "recorded") return { error: outcomeError(outcome, { remaining: typeof res.remaining === "number" ? res.remaining : undefined }) };
  const paymentId = String(res.payment_id ?? "");
  const info = paymentId
    ? await recordCollectionCash(supabase, { accountId: input.accountId, sourceType: "building", sourceId: paymentId, amount: amount.value, date: input.paidOn, title: "Aidat tahsilatı" })
    : null;
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: paymentId, receiptNo: Number(res.receipt_no) || undefined, info: info ?? undefined };
}

/** Tahsilat iptali: silinmez; neden zorunlu, durum yeniden türetilir, denetim kaydı yazılır. */
export async function voidBuildingPayment(input: { paymentId: string; reason: string }): Promise<BmResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.paymentId)) return { error: "Tahsilat kaydı bulunamadı." };
  const reason = input.reason.trim();
  if (reason.length < 3) return { error: "İptal nedenini yazın (en az 3 karakter)." };
  if (reason.length > 300) return { error: "İptal nedeni en fazla 300 karakter olabilir." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_building_payment", { p_payment_id: input.paymentId, p_reason: reason });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("voidBuildingPayment", { code: error.code });
    return { error: actionErrorMessage(error, "Tahsilat iptal edilemedi") };
  }
  const outcome = typeof asObject(data).outcome === "string" ? String(asObject(data).outcome) : "invalid_result";
  if (outcome !== "voided") return { error: outcomeError(outcome) };
  await voidCollectionCash(supabase, "building", input.paymentId, "Aidat tahsilatı iptal edildi");
  revalidateTenantData(gate.tenantId, [...PATHS, "/app/kiralama"]);
  return { ok: true };
}

/**
 * Malikin aidat borcunu kira hakedişinden mahsup et: tahsilat method=owner_offset olarak kaydedilir ve tutar hakedişe
 * "aidat kesintisi" olarak yansır. Yetki: expenses:edit VE rentals:edit.
 */
export async function offsetChargeToOwner(input: { chargeId: string; amount: string | number }): Promise<BmResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  const rentalsGate = await requirePermission("rentals", "edit");
  if (!rentalsGate.ok) return { error: rentalsGate.error };
  if (!isUuid(input.chargeId)) return { error: "Tahakkuk bulunamadı." };
  const amount = parseMoneyInput(input.amount, { max: 1_000_000_000 });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offset_building_charge_to_owner", { p_charge_id: input.chargeId, p_amount: amount.value });
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("offsetChargeToOwner", { code: error.code });
    return { error: actionErrorMessage(error, "Mahsup yapılamadı") };
  }
  const res = asObject(data);
  const outcome = typeof res.outcome === "string" ? res.outcome : "invalid_result";
  if (outcome !== "recorded") return { error: outcomeError(outcome, { remaining: typeof res.remaining === "number" ? res.remaining : undefined }) };
  revalidateTenantData(gate.tenantId, [...PATHS, "/app/kiralama"]);
  return { ok: true, id: String(res.payment_id ?? ""), receiptNo: Number(res.receipt_no) || undefined };
}
