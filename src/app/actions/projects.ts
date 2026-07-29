"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { calculateCommission, buildSplits } from "@/lib/commission";

export type ProjectResult = { ok?: boolean; error?: string; id?: string };

export type UnitStatus = "available" | "reserved" | "deposit" | "sold";

export type ProjectRow = {
  id: string;
  name: string;
  developer_name: string | null;
  location: string | null;
  delivery_date: string | null;
  description: string | null;
  status: "planning" | "selling" | "delivered";
  created_at: string;
  units: { status: UnitStatus }[];
};

export type UnitRow = {
  id: string;
  project_id: string;
  block: string | null;
  floor: number | null;
  unit_no: string;
  rooms: string | null;
  gross_m2: number | null;
  list_price: number | null;
  status: UnitStatus;
  customer_id: string | null;
  reserved_until: string | null;
  sold_at: string | null;
  notes: string | null;
  customer: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null;
};

// ============================================================
// Okuma
// ============================================================

export async function listProjects(): Promise<ProjectRow[]> {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, name, developer_name, location, delivery_date, description, status, created_at, units:project_units(status)",
    )
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listProjects", error);
    return [];
  }
  return (data ?? []) as ProjectRow[];
}

export async function getProject(id: string) {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, developer_name, location, delivery_date, description, status, created_at")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  return data;
}

export async function listProjectUnits(projectId: string): Promise<UnitRow[]> {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_units")
    .select(
      "id, project_id, block, floor, unit_no, rooms, gross_m2, list_price, status, customer_id, reserved_until, sold_at, notes, customer:customers(id, full_name)",
    )
    .eq("project_id", projectId)
    .eq("tenant_id", gate.tenantId)
    .order("block", { ascending: true })
    .order("floor", { ascending: false })
    .order("unit_no", { ascending: true })
    .limit(1000);

  if (error) {
    console.error("listProjectUnits", error);
    return [];
  }
  return (data ?? []) as UnitRow[];
}

// ============================================================
// Proje oluşturma
// ============================================================

export async function createProject(_prev: ProjectResult, fd: FormData): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "create");
  if (!gate.ok) return { error: gate.error };

  const name         = String(fd.get("name") ?? "").trim();
  const developer    = String(fd.get("developer_name") ?? "").trim() || null;
  const location     = String(fd.get("location") ?? "").trim() || null;
  const deliveryDate = String(fd.get("delivery_date") ?? "").trim() || null;
  const description  = String(fd.get("description") ?? "").trim() || null;
  const statusRaw    = String(fd.get("status") ?? "selling");
  const status       = ["planning", "selling", "delivered"].includes(statusRaw) ? statusRaw : "selling";

  if (!name) return { error: "Proje adı zorunludur." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      tenant_id: gate.tenantId,
      created_by: gate.userId,
      name,
      developer_name: developer,
      location,
      delivery_date: deliveryDate,
      description,
      status,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createProject", error);
    return { error: "Proje kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "project.create",
    entityType: "project",
    entityId: data.id,
    newValue: { name, status },
  });

  revalidatePath("/app/projeler");
  return { ok: true, id: data.id };
}

// ============================================================
// Daire ekleme — tekil + çoğalt
// ============================================================

export async function addUnit(_prev: ProjectResult, fd: FormData): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "create");
  if (!gate.ok) return { error: gate.error };

  const projectId = String(fd.get("project_id") ?? "").trim();
  const block     = String(fd.get("block") ?? "").trim() || null;
  const floorRaw  = String(fd.get("floor") ?? "").trim();
  const floor     = floorRaw === "" ? null : parseInt(floorRaw, 10);
  const unitNo    = String(fd.get("unit_no") ?? "").trim();
  const rooms     = String(fd.get("rooms") ?? "").trim() || null;
  const grossRaw  = parseFloat(String(fd.get("gross_m2") ?? ""));
  const priceRaw  = parseFloat(String(fd.get("list_price") ?? ""));
  const notes     = String(fd.get("notes") ?? "").trim() || null;

  if (!projectId) return { error: "Proje bulunamadı." };
  if (!unitNo) return { error: "Daire no zorunludur." };
  if (floor != null && isNaN(floor)) return { error: "Geçerli bir kat girin." };
  if (!(await projectBelongsToTenant(gate.tenantId, projectId))) return { error: "Proje bulunamadı." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_units")
    .insert({
      tenant_id: gate.tenantId,
      project_id: projectId,
      block,
      floor,
      unit_no: unitNo,
      rooms,
      gross_m2: isNaN(grossRaw) ? null : grossRaw,
      list_price: isNaN(priceRaw) ? null : priceRaw,
      notes,
      status: "available",
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { error: "Bu blokta aynı daire numarası zaten kayıtlı." };
    console.error("addUnit", error);
    return { error: "Daire kaydedilemedi." };
  }

  revalidatePath(`/app/projeler/${projectId}`);
  revalidatePath("/app/projeler");
  return { ok: true, id: data.id };
}

/**
 * "Çoğalt" — aynı bloka N kat × M daire hızlı üretim (basit döngü).
 * Daire no: kat×100 + sıra (örn. 3. kat 2. daire → 302).
 */
export async function bulkAddUnits(_prev: ProjectResult, fd: FormData): Promise<ProjectResult & { created?: number }> {
  const gate = await requirePermission("projects", "create");
  if (!gate.ok) return { error: gate.error };

  const projectId  = String(fd.get("project_id") ?? "").trim();
  const block      = String(fd.get("block") ?? "").trim() || null;
  const startFloor = parseInt(String(fd.get("start_floor") ?? "1"), 10);
  const floorCount = parseInt(String(fd.get("floor_count") ?? "0"), 10);
  const perFloor   = parseInt(String(fd.get("units_per_floor") ?? "0"), 10);
  const rooms      = String(fd.get("rooms") ?? "").trim() || null;
  const grossRaw   = parseFloat(String(fd.get("gross_m2") ?? ""));
  const priceRaw   = parseFloat(String(fd.get("list_price") ?? ""));

  if (!projectId) return { error: "Proje bulunamadı." };
  if (isNaN(startFloor)) return { error: "Geçerli bir başlangıç katı girin." };
  if (isNaN(floorCount) || floorCount < 1) return { error: "Kat sayısı en az 1 olmalı." };
  if (isNaN(perFloor) || perFloor < 1) return { error: "Kat başına daire en az 1 olmalı." };
  if (floorCount * perFloor > 200) return { error: "Tek seferde en fazla 200 daire üretilebilir." };
  if (!(await projectBelongsToTenant(gate.tenantId, projectId))) return { error: "Proje bulunamadı." };

  const rows = [];
  for (let f = startFloor; f < startFloor + floorCount; f++) {
    for (let u = 1; u <= perFloor; u++) {
      rows.push({
        tenant_id: gate.tenantId,
        project_id: projectId,
        block,
        floor: f,
        unit_no: String(f * 100 + u),
        rooms,
        gross_m2: isNaN(grossRaw) ? null : grossRaw,
        list_price: isNaN(priceRaw) ? null : priceRaw,
        status: "available" as const,
      });
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("project_units").insert(rows);

  if (error) {
    if (error.code === "23505") return { error: "Bu blokta çakışan daire numaraları var — önce mevcut daireleri kontrol edin." };
    console.error("bulkAddUnits", error);
    return { error: "Daireler kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "project_unit.bulk_create",
    entityType: "project",
    entityId: projectId,
    newValue: { block, start_floor: startFloor, floor_count: floorCount, units_per_floor: perFloor, created: rows.length },
  });

  revalidatePath(`/app/projeler/${projectId}`);
  revalidatePath("/app/projeler");
  return { ok: true, created: rows.length };
}

// ============================================================
// Durum geçişleri — hepsi logActivity ile denetlenir
// ============================================================

async function getUnitForUpdate(tenantId: string, unitId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_units")
    .select("id, project_id, unit_no, block, status, customer_id, reserved_until, sold_at")
    .eq("id", unitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

async function auditStatusChange(
  tenantId: string,
  actorId: string,
  unit: { id: string; project_id: string; block: string | null; unit_no: string; status: string },
  next: Record<string, unknown>,
) {
  await logActivity({
    tenantId,
    actorId,
    action: "project_unit.status",
    entityType: "project_unit",
    entityId: unit.id,
    oldValue: { status: unit.status },
    newValue: { ...next, project_id: unit.project_id, block: unit.block, unit_no: unit.unit_no },
  });
}

function revalidateUnit(projectId: string) {
  revalidatePath(`/app/projeler/${projectId}`);
  revalidatePath("/app/projeler");
}

/** Tenant izolasyonu: proje bu ofise ait mi? (FK tek başına bunu garanti etmez) */
async function projectBelongsToTenant(tenantId: string, projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return Boolean(data);
}

/** Tenant izolasyonu: müşteri bu ofise ait mi? */
async function customerBelongsToTenant(tenantId: string, customerId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return Boolean(data);
}

/** Rezerve et — müşteri zorunlu, opsiyon süresi gün cinsinden. */
export async function reserveUnit(unitId: string, customerId: string, optionDays: number): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!customerId) return { error: "Rezervasyon için müşteri seçin." };

  const unit = await getUnitForUpdate(gate.tenantId, unitId);
  if (!unit) return { error: "Daire bulunamadı." };
  if (unit.status === "sold") return { error: "Satılmış daire rezerve edilemez." };
  if (!(await customerBelongsToTenant(gate.tenantId, customerId))) return { error: "Müşteri bulunamadı." };

  const days = Number.isFinite(optionDays) && optionDays > 0 ? Math.min(optionDays, 90) : 7;
  const reservedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_units")
    .update({ status: "reserved", customer_id: customerId, reserved_until: reservedUntil, sold_at: null })
    .eq("id", unitId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Rezervasyon kaydedilemedi." };

  await auditStatusChange(gate.tenantId, gate.userId, unit, {
    status: "reserved",
    customer_id: customerId,
    reserved_until: reservedUntil,
  });
  revalidateUnit(unit.project_id);
  return { ok: true };
}

/** Kapora alındı — mevcut müşteri korunur; müsait daireye müşteri ile de işlenebilir. */
export async function markUnitDeposit(unitId: string, customerId?: string): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };

  const unit = await getUnitForUpdate(gate.tenantId, unitId);
  if (!unit) return { error: "Daire bulunamadı." };
  if (unit.status === "sold") return { error: "Satılmış daire için kapora işlenemez." };

  const customer = customerId || unit.customer_id;
  if (!customer) return { error: "Kapora için müşteri seçin." };
  if (customerId && !(await customerBelongsToTenant(gate.tenantId, customerId))) {
    return { error: "Müşteri bulunamadı." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_units")
    .update({ status: "deposit", customer_id: customer })
    .eq("id", unitId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Kapora kaydedilemedi." };

  await auditStatusChange(gate.tenantId, gate.userId, unit, { status: "deposit", customer_id: customer });
  revalidateUnit(unit.project_id);
  return { ok: true };
}

/** Satıldı — müşteri zorunlu (parametre ya da dairedeki mevcut müşteri). */
export async function sellUnit(unitId: string, customerId?: string): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };

  const unit = await getUnitForUpdate(gate.tenantId, unitId);
  if (!unit) return { error: "Daire bulunamadı." };
  if (unit.status === "sold") return { error: "Daire zaten satılmış." };

  const customer = customerId || unit.customer_id;
  if (!customer) return { error: "Satış için müşteri seçilmesi zorunludur." };
  if (customerId && !(await customerBelongsToTenant(gate.tenantId, customerId))) {
    return { error: "Müşteri bulunamadı." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_units")
    .update({ status: "sold", customer_id: customer, sold_at: new Date().toISOString(), reserved_until: null })
    .eq("id", unitId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Satış kaydedilemedi." };

  await auditStatusChange(gate.tenantId, gate.userId, unit, { status: "sold", customer_id: customer });

  // C.1 — Proje dairesi satışı `deals` + `commissions`'a yazılır. Aksi halde
  // proje satışları ciro/komisyon/lig raporlarında GÖRÜNMÜYORDU (yalnız
  // project_units.status='sold' oluyordu). Hata satışı bozmaz (best-effort + log).
  try {
    await recordProjectSaleDeal(gate.tenantId, gate.userId, unitId, customer);
  } catch (e) {
    console.error("sellUnit deal/commission", e);
  }

  revalidateUnit(unit.project_id);
  return { ok: true };
}

/**
 * Proje dairesi satışını normal anlaşma hattına bağlar: property'siz `won`+`sale`
 * deal + komisyon (satılık portföyle BİREBİR aynı `calculateCommission`/`buildSplits`,
 * oran verilmezse ofis varsayılanı). İzlenebilirlik için proje/daire bilgisi
 * deal notuna yazılır (deal'ın property_id'si yok). deal_value = dairenin list_price.
 */
async function recordProjectSaleDeal(
  tenantId: string,
  userId: string,
  unitId: string,
  customerId: string,
) {
  const supabase = await createClient();
  const { data: u } = await supabase
    .from("project_units")
    .select("list_price, unit_no, block, project:projects(name)")
    .eq("id", unitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const value = Number(u?.list_price);
  const dealValue = Number.isFinite(value) && value > 0 ? value : null;

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      property_id: null,
      deal_type: "sale",
      stage: "won",
      deal_value: dealValue,
      probability: 100,
      assigned_to: userId,
    })
    .select("id")
    .single();
  if (dealErr || !deal) return;

  // Komisyon — yalnız değer varsa. gross_amount alanı mevcut kod deseninde net'i
  // tutar (isim yanıltıcı ama tutarlılık için birebir korundu, bkz. deals.ts).
  if (dealValue) {
    const calc = calculateCommission({ amount: dealValue });
    const splits = buildSplits(calc.net);
    await supabase.from("commissions").insert({
      tenant_id: tenantId,
      deal_id: deal.id,
      gross_amount: calc.net,
      vat_amount: calc.vat,
      status: "calculated",
      splits,
    });
  }

  // İzlenebilirlik: deal'ın property'si olmadığından proje/daire notu düşülür.
  const proj = u?.project as { name?: string } | { name?: string }[] | null | undefined;
  const projectName = Array.isArray(proj) ? proj[0]?.name : proj?.name;
  const unitLabel = [u?.block, u?.unit_no].filter(Boolean).join(" / ") || "Daire";
  await supabase.from("deal_notes").insert({
    tenant_id: tenantId,
    deal_id: deal.id,
    author_id: userId,
    body: `Proje satışı — ${projectName ?? "Proje"} · ${unitLabel}`,
  });
}

// ============================================================
// Ödeme planı — peşinat + taksit + ara ödeme (unit_payments)
// ============================================================

export type PaymentKind = "pesinat" | "taksit" | "ara_odeme";
export type PaymentStatus = "pending" | "paid" | "overdue";

export type UnitPaymentRow = {
  id: string;
  unit_id: string;
  kind: PaymentKind;
  seq: number;
  due_date: string;
  amount: number;
  status: PaymentStatus;
  paid_at: string | null;
  notes: string | null;
};

/**
 * `YYYY-MM-DD` + N ay → aynı gün (28'e kırpılır — Şubat dahil her ayda
 * geçerli vade günü; rentals.due_day ile aynı gerekçe). String aritmetiği:
 * timezone kayması yok.
 */
function addMonthsClamped(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(d, 28);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function listUnitPayments(unitId: string): Promise<UnitPaymentRow[]> {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_payments")
    .select("id, unit_id, kind, seq, due_date, amount, status, paid_at, notes")
    .eq("unit_id", unitId)
    .eq("tenant_id", gate.tenantId)
    .order("due_date", { ascending: true })
    .order("seq", { ascending: true })
    .limit(200);

  if (error) {
    console.error("listUnitPayments", error);
    return [];
  }
  return (data ?? []) as UnitPaymentRow[];
}

/**
 * Ödeme planı üret — kaporalı/satılan daire için liste fiyatından:
 * peşinat (% → başlangıç günü) + varsa ara ödemeler + kalan tutar eşit taksit.
 * Kuruş hassasiyeti: hesap cent (×100) düzleminde, son taksit farkı kapatır.
 * Taksit vadeleri = plan başlangıç günü (28'e kırpılır), aylık.
 */
export async function createPaymentPlan(
  unitId: string,
  opts: {
    pesinatPct: number;
    taksitSayisi: number;
    /** Plan başlangıç tarihi `YYYY-MM-DD` — peşinat vadesi; taksitler +1..+N ay */
    baslangicAyi: string;
    /** Ara ödemeler — ay: başlangıçtan ay ofseti (1..), tutar TL */
    araOdemeler?: { ay: number; tutar: number }[];
  },
): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: unit } = await supabase
    .from("project_units")
    .select("id, project_id, block, unit_no, status, list_price")
    .eq("id", unitId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!unit) return { error: "Daire bulunamadı." };
  if (unit.status !== "deposit" && unit.status !== "sold") {
    return { error: "Ödeme planı yalnızca kaporalı veya satılmış daireler için oluşturulabilir." };
  }
  if (!unit.list_price || Number(unit.list_price) <= 0) {
    return { error: "Önce dairenin liste fiyatını girin." };
  }

  const pct = Number(opts.pesinatPct);
  const n = Math.trunc(Number(opts.taksitSayisi));
  const start = String(opts.baslangicAyi ?? "").trim();
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return { error: "Peşinat oranı 0-99 arasında olmalı." };
  if (!Number.isFinite(n) || n < 1 || n > 120) return { error: "Taksit sayısı 1-120 arasında olmalı." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { error: "Geçerli bir başlangıç tarihi seçin." };

  const { data: existing } = await supabase
    .from("unit_payments")
    .select("id")
    .eq("unit_id", unitId)
    .eq("tenant_id", gate.tenantId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return { error: "Bu daire için zaten bir ödeme planı var — önce planı silin." };
  }

  const totalCents = Math.round(Number(unit.list_price) * 100);
  const pesinatCents = Math.round((totalCents * pct) / 100);

  const araList = (opts.araOdemeler ?? [])
    .map((a) => ({ ay: Math.trunc(Number(a.ay)), cents: Math.round(Number(a.tutar) * 100) }))
    .filter((a) => Number.isFinite(a.ay) && a.ay >= 1 && a.cents > 0);
  const araCents = araList.reduce((s, a) => s + a.cents, 0);

  const kalanCents = totalCents - pesinatCents - araCents;
  if (kalanCents <= 0) return { error: "Peşinat ve ara ödemeler liste fiyatını aşıyor — taksite tutar kalmadı." };

  const taksitCents = Math.floor(kalanCents / n);
  if (taksitCents <= 0) return { error: "Taksit tutarı sıfıra düşüyor — taksit sayısını azaltın." };
  const sonTaksitCents = kalanCents - taksitCents * (n - 1);

  type Row = {
    tenant_id: string; unit_id: string; kind: PaymentKind; seq: number;
    due_date: string; amount: number; status: "pending"; created_by: string;
  };
  const rows: Row[] = [];

  if (pesinatCents > 0) {
    rows.push({
      tenant_id: gate.tenantId, unit_id: unitId, kind: "pesinat", seq: 0,
      due_date: start, amount: pesinatCents / 100, status: "pending", created_by: gate.userId,
    });
  }
  for (let i = 1; i <= n; i++) {
    rows.push({
      tenant_id: gate.tenantId, unit_id: unitId, kind: "taksit", seq: i,
      due_date: addMonthsClamped(start, i),
      amount: (i === n ? sonTaksitCents : taksitCents) / 100,
      status: "pending", created_by: gate.userId,
    });
  }
  for (const a of araList) {
    rows.push({
      tenant_id: gate.tenantId, unit_id: unitId, kind: "ara_odeme", seq: a.ay,
      due_date: addMonthsClamped(start, a.ay), amount: a.cents / 100,
      status: "pending", created_by: gate.userId,
    });
  }

  const { error } = await supabase.from("unit_payments").insert(rows);
  if (error) {
    console.error("createPaymentPlan", error);
    return { error: "Ödeme planı kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "unit_payment.plan_create",
    entityType: "project_unit",
    entityId: unitId,
    newValue: {
      project_id: unit.project_id, block: unit.block, unit_no: unit.unit_no,
      pesinat_pct: pct, taksit_sayisi: n, baslangic: start,
      ara_odeme_sayisi: araList.length, toplam: totalCents / 100, satir: rows.length,
    },
  });

  revalidateUnit(unit.project_id);
  return { ok: true };
}

/**
 * Planı sil — yalnızca hiç 'paid' satır yoksa (ödeme alınmış plan silinemez).
 * ConfirmDialog `formAction` uyumlu: FormData alır, void döner
 * (hata durumunda sessiz no-op — koşullar UI'da da denetlenir).
 */
export async function deletePaymentPlan(fd: FormData): Promise<void> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return;

  const unitId = String(fd.get("unit_id") ?? "").trim();
  if (!unitId) return;

  const supabase = await createClient();
  const { data: unit } = await supabase
    .from("project_units")
    .select("id, project_id, block, unit_no")
    .eq("id", unitId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!unit) return;

  const { data: paid } = await supabase
    .from("unit_payments")
    .select("id")
    .eq("unit_id", unitId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "paid")
    .limit(1);
  if ((paid ?? []).length > 0) return; // ödeme alınmış plan silinemez

  const { error } = await supabase
    .from("unit_payments")
    .delete()
    .eq("unit_id", unitId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deletePaymentPlan", error);
    return;
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "unit_payment.plan_delete",
    entityType: "project_unit",
    entityId: unitId,
    newValue: { project_id: unit.project_id, block: unit.block, unit_no: unit.unit_no },
  });

  revalidateUnit(unit.project_id);
}

/** Ödendi ↔ bekliyor geçişi — overdue satır da 'paid' yapılabilir; geri alınırsa 'pending' olur (cron yeniden gecikmeye alır). */
export async function togglePaymentPaid(paymentId: string): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("unit_payments")
    .select("id, unit_id, kind, seq, due_date, amount, status, unit:project_units(project_id)")
    .eq("id", paymentId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!payment) return { error: "Ödeme satırı bulunamadı." };

  const toPaid = payment.status !== "paid";
  const { error } = await supabase
    .from("unit_payments")
    .update(toPaid ? { status: "paid", paid_at: new Date().toISOString() } : { status: "pending", paid_at: null })
    .eq("id", paymentId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Ödeme durumu güncellenemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "unit_payment.toggle",
    entityType: "unit_payment",
    entityId: paymentId,
    oldValue: { status: payment.status },
    newValue: { status: toPaid ? "paid" : "pending", unit_id: payment.unit_id, kind: payment.kind, seq: payment.seq, amount: payment.amount },
  });

  const unitRel = Array.isArray(payment.unit) ? payment.unit[0] : payment.unit;
  if (unitRel?.project_id) revalidateUnit(unitRel.project_id as string);
  return { ok: true };
}

/**
 * Proje geneli tahsilat özeti — üst KPI'lar için:
 * bu ay beklenen (paid olmayan, vadesi bu ay) + geciken (overdue ya da vadesi geçmiş pending).
 */
export async function getProjectPaymentSummary(projectId: string): Promise<{
  monthExpected: number;
  overdueCount: number;
  overdueSum: number;
}> {
  const empty = { monthExpected: 0, overdueCount: 0, overdueSum: 0 };
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return empty;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_payments")
    .select("amount, status, due_date, unit:project_units!inner(project_id)")
    .eq("tenant_id", gate.tenantId)
    .eq("unit.project_id", projectId)
    .neq("status", "paid")
    .limit(5000);

  if (error) {
    console.error("getProjectPaymentSummary", error);
    return empty;
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthPrefix = today.slice(0, 7);
  let monthExpected = 0;
  let overdueCount = 0;
  let overdueSum = 0;

  for (const p of data ?? []) {
    const due = String(p.due_date);
    const amount = Number(p.amount) || 0;
    if (due.slice(0, 7) === monthPrefix) monthExpected += amount;
    if (p.status === "overdue" || due < today) {
      overdueCount += 1;
      overdueSum += amount;
    }
  }
  return { monthExpected, overdueCount, overdueSum };
}

/** Serbest bırak — rezervasyon/kapora/satış geri alınır, daire müsait olur. */
export async function releaseUnit(unitId: string): Promise<ProjectResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };

  const unit = await getUnitForUpdate(gate.tenantId, unitId);
  if (!unit) return { error: "Daire bulunamadı." };
  if (unit.status === "available") return { error: "Daire zaten müsait." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_units")
    .update({ status: "available", customer_id: null, reserved_until: null, sold_at: null })
    .eq("id", unitId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Daire serbest bırakılamadı." };

  await auditStatusChange(gate.tenantId, gate.userId, unit, { status: "available" });
  revalidateUnit(unit.project_id);
  return { ok: true };
}
