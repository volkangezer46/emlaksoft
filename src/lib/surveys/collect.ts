import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventKey } from "@/lib/surveys/logic";
import type { EventCandidate } from "@/lib/surveys/server";
import type { SurveyEventType } from "@/lib/surveys/types";

/**
 * Olay toplayıcılar: her biri tek ofis için, `sinceIso` sonrasındaki olayları okur ve aday listesi döner.
 * Okuma hatası loglanır ve boş liste döner (bir olay türü diğerlerini durdurmaz). Örnek (is_sample) kayıtlar
 * anket üretmez. Tüm sorgular tenant süzgeçlidir (service role ile çalışır).
 *
 * İlan sahibi (malik) ayrı bir müşteri kaydı değildir; ad/telefon, portföye bağlı en güncel malik portalı
 * kaydından (owner_portal_tokens) alınır. Kayıt yoksa görev yine üretilir, anketör numarayı panelden ekler.
 */

const CAP = 300;
const UNPUBLISH_STATUSES = ["sold", "rented", "withdrawn", "passive", "archived", "auth_expired"] as const;

const STATUS_TEXT: Record<string, string> = {
  sold: "satıldı",
  rented: "kiralandı",
  withdrawn: "malik vazgeçti / geri çekildi",
  passive: "pasife alındı",
  archived: "arşivlendi",
  auth_expired: "yetki süresi doldu",
};

type OwnerContact = { name: string | null; phone: string | null };

async function ownerContacts(db: SupabaseClient, tenantId: string, propertyIds: string[]): Promise<Map<string, OwnerContact>> {
  const map = new Map<string, OwnerContact>();
  if (propertyIds.length === 0) return map;
  const { data } = await db
    .from("owner_portal_tokens")
    .select("property_id, owner_name, owner_phone, created_at")
    .eq("tenant_id", tenantId)
    .in("property_id", propertyIds)
    .order("created_at", { ascending: false })
    .limit(2000);
  for (const r of data ?? []) {
    const id = String(r.property_id);
    if (!map.has(id)) map.set(id, { name: (r.owner_name as string | null) ?? null, phone: (r.owner_phone as string | null) ?? null });
  }
  return map;
}

type PropRow = { id: string; property_code: string | null; title: string | null; assigned_to: string | null; is_sample: boolean | null; deleted_at: string | null };

async function propertiesById(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, PropRow>> {
  const map = new Map<string, PropRow>();
  if (ids.length === 0) return map;
  const { data } = await db
    .from("properties")
    .select("id, property_code, title, assigned_to, is_sample, deleted_at")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  for (const p of (data ?? []) as PropRow[]) map.set(String(p.id), p);
  return map;
}

type CustRow = { id: string; full_name: string | null; is_sample: boolean | null; deleted_at: string | null };

async function customersById(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, CustRow>> {
  const map = new Map<string, CustRow>();
  if (ids.length === 0) return map;
  const { data } = await db.from("customers").select("id, full_name, is_sample, deleted_at").eq("tenant_id", tenantId).in("id", ids);
  for (const c of (data ?? []) as CustRow[]) map.set(String(c.id), c);
  return map;
}

function propLabel(p: PropRow | undefined): string {
  if (!p) return "Portföy";
  return [p.property_code, p.title].filter(Boolean).join(" ") || "Portföy";
}

function usableProperty(p: PropRow | undefined): p is PropRow {
  return Boolean(p) && !p!.is_sample && !p!.deleted_at;
}
function usableCustomer(c: CustRow | undefined): c is CustRow {
  return Boolean(c) && !c!.is_sample && !c!.deleted_at;
}

/* ------------------------------------------------------- yayından kalkan ilan */

export async function collectPropertyUnpublished(db: SupabaseClient, tenantId: string, sinceIso: string, todayDate: string): Promise<EventCandidate[]> {
  const out: EventCandidate[] = [];

  const { data: history, error } = await db
    .from("property_status_history")
    .select("id, property_id, old_status, new_status, reason, created_at")
    .eq("tenant_id", tenantId)
    .in("new_status", [...UNPUBLISH_STATUSES])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(CAP);
  if (error) console.error("anket: durum geçmişi", error.message);

  const { data: expired, error: expErr } = await db
    .from("properties")
    .select("id, property_code, title, assigned_to, is_sample, deleted_at, authorization_end")
    .eq("tenant_id", tenantId)
    .eq("status", "live")
    .is("deleted_at", null)
    .not("authorization_end", "is", null)
    .lt("authorization_end", todayDate)
    .gte("authorization_end", sinceIso.slice(0, 10))
    .limit(CAP);
  if (expErr) console.error("anket: süresi dolan ilanlar", expErr.message);

  const ids = [...new Set([...(history ?? []).map((h) => String(h.property_id)), ...(expired ?? []).map((p) => String(p.id))])];
  const [props, owners] = await Promise.all([propertiesById(db, tenantId, ids), ownerContacts(db, tenantId, ids)]);

  for (const h of history ?? []) {
    if (h.old_status === h.new_status) continue;
    const p = props.get(String(h.property_id));
    if (!usableProperty(p)) continue;
    const owner = owners.get(p.id);
    out.push({
      eventType: "property_unpublished",
      audience: "owner",
      eventKey: eventKey("property_unpublished", String(h.id), "owner"),
      summary: `${propLabel(p)}: ${STATUS_TEXT[String(h.new_status)] ?? String(h.new_status)}${h.reason ? ` (${String(h.reason).slice(0, 80)})` : ""}`,
      eventAt: String(h.created_at),
      propertyId: p.id,
      contactName: owner?.name ?? null,
      contactPhone: owner?.phone ?? null,
      agentId: p.assigned_to,
    });
  }
  for (const e of expired ?? []) {
    const p = props.get(String(e.id));
    if (!usableProperty(p)) continue;
    const owner = owners.get(p.id);
    const end = String(e.authorization_end);
    out.push({
      eventType: "property_unpublished",
      audience: "owner",
      eventKey: eventKey("property_unpublished", p.id, "owner", `sure-${end}`),
      summary: `${propLabel(p)}: yetki süresi doldu (${end})`,
      eventAt: `${end}T09:00:00.000Z`,
      propertyId: p.id,
      contactName: owner?.name ?? null,
      contactPhone: owner?.phone ?? null,
      agentId: p.assigned_to,
    });
  }
  return out;
}

/* ----------------------------------------------------------- işlem gören / kayıp */

type DealRow = {
  id: string;
  deal_type: string;
  stage: string;
  customer_id: string | null;
  property_id: string | null;
  assigned_to: string | null;
  loss_reason: string | null;
  updated_at: string;
};

async function dealsInStage(db: SupabaseClient, tenantId: string, stage: "won" | "lost", sinceIso: string): Promise<DealRow[]> {
  const { data, error } = await db
    .from("deals")
    .select("id, deal_type, stage, customer_id, property_id, assigned_to, loss_reason, updated_at")
    .eq("tenant_id", tenantId)
    .eq("stage", stage)
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(CAP);
  if (error) console.error(`anket: ${stage} anlaşmalar`, error.message);
  return (data ?? []) as DealRow[];
}

export async function collectDealWon(db: SupabaseClient, tenantId: string, sinceIso: string): Promise<EventCandidate[]> {
  const deals = await dealsInStage(db, tenantId, "won", sinceIso);
  const propIds = [...new Set(deals.map((d) => d.property_id).filter((v): v is string => Boolean(v)))];
  const custIds = [...new Set(deals.map((d) => d.customer_id).filter((v): v is string => Boolean(v)))];
  const [props, custs, owners] = await Promise.all([
    propertiesById(db, tenantId, propIds),
    customersById(db, tenantId, custIds),
    ownerContacts(db, tenantId, propIds),
  ]);
  const out: EventCandidate[] = [];
  for (const d of deals) {
    const rent = d.deal_type === "rent";
    const p = d.property_id ? props.get(d.property_id) : undefined;
    if (p && p.is_sample) continue;
    const label = p ? propLabel(p) : "Anlaşma";
    const cust = d.customer_id ? custs.get(d.customer_id) : undefined;
    if (usableCustomer(cust)) {
      const audience = rent ? "tenant" : "buyer";
      out.push({
        eventType: "deal_won",
        audience,
        eventKey: eventKey("deal_won", d.id, audience),
        summary: `${label}: ${rent ? "kira bağlandı" : "satış kapandı"}`,
        eventAt: d.updated_at,
        customerId: cust.id,
        propertyId: d.property_id,
        dealId: d.id,
        agentId: d.assigned_to,
      });
    }
    if (p && usableProperty(p)) {
      const owner = owners.get(p.id);
      const audience = rent ? "landlord" : "seller";
      out.push({
        eventType: "deal_won",
        audience,
        eventKey: eventKey("deal_won", d.id, audience),
        summary: `${label}: ${rent ? "kira bağlandı" : "satış kapandı"} (${rent ? "ev sahibi" : "satıcı"})`,
        eventAt: d.updated_at,
        propertyId: p.id,
        dealId: d.id,
        contactName: owner?.name ?? null,
        contactPhone: owner?.phone ?? null,
        agentId: d.assigned_to,
      });
    }
  }
  return out;
}

export async function collectDealLost(db: SupabaseClient, tenantId: string, sinceIso: string): Promise<EventCandidate[]> {
  const deals = await dealsInStage(db, tenantId, "lost", sinceIso);
  const custIds = [...new Set(deals.map((d) => d.customer_id).filter((v): v is string => Boolean(v)))];
  const propIds = [...new Set(deals.map((d) => d.property_id).filter((v): v is string => Boolean(v)))];
  const [custs, props] = await Promise.all([customersById(db, tenantId, custIds), propertiesById(db, tenantId, propIds)]);
  const out: EventCandidate[] = [];
  for (const d of deals) {
    const cust = d.customer_id ? custs.get(d.customer_id) : undefined;
    if (!usableCustomer(cust)) continue;
    const p = d.property_id ? props.get(d.property_id) : undefined;
    if (p?.is_sample) continue;
    out.push({
      eventType: "deal_lost",
      audience: "customer",
      eventKey: eventKey("deal_lost", d.id, "customer"),
      summary: `${p ? propLabel(p) : "Anlaşma"}: kaybedildi${d.loss_reason ? ` (${d.loss_reason.slice(0, 80)})` : ""}`,
      eventAt: d.updated_at,
      customerId: cust.id,
      propertyId: d.property_id,
      dealId: d.id,
      agentId: d.assigned_to,
    });
  }
  return out;
}

/**
 * Kapanan talep. Talep tablosunda kapanış zamanı tutulmadığı için YALNIZ tetikleyici açıldıktan sonra
 * oluşturulan ve kapanmış talepler alınır; aynı müşteriye sonradan kazanılmış anlaşma varsa talep "kayıp" sayılmaz.
 */
export async function collectDemandLost(db: SupabaseClient, tenantId: string, sinceIso: string): Promise<EventCandidate[]> {
  const { data, error } = await db
    .from("customer_demands")
    .select("id, customer_id, transaction_type, created_at, is_sample")
    .eq("tenant_id", tenantId)
    .eq("status", "closed")
    .eq("is_sample", false)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(CAP);
  if (error) {
    console.error("anket: kapanan talepler", error.message);
    return [];
  }
  const demands = data ?? [];
  const custIds = [...new Set(demands.map((d) => String(d.customer_id)))];
  if (custIds.length === 0) return [];
  const [custs, { data: won }, { data: assigned }] = await Promise.all([
    customersById(db, tenantId, custIds),
    db.from("deals").select("customer_id, updated_at").eq("tenant_id", tenantId).eq("stage", "won").in("customer_id", custIds),
    db.from("customers").select("id, assigned_to").eq("tenant_id", tenantId).in("id", custIds),
  ]);
  const agentOf = new Map((assigned ?? []).map((c) => [String(c.id), (c.assigned_to as string | null) ?? null]));
  const out: EventCandidate[] = [];
  for (const d of demands) {
    const cid = String(d.customer_id);
    const cust = custs.get(cid);
    if (!usableCustomer(cust)) continue;
    const created = Date.parse(String(d.created_at));
    if ((won ?? []).some((w) => String(w.customer_id) === cid && Date.parse(String(w.updated_at)) >= created)) continue;
    out.push({
      eventType: "demand_lost",
      audience: "customer",
      eventKey: eventKey("demand_lost", String(d.id), "customer"),
      summary: `${d.transaction_type === "rent" ? "Kiralık" : "Satılık"} talebi kapandı`,
      eventAt: String(d.created_at),
      customerId: cid,
      agentId: agentOf.get(cid) ?? null,
    });
  }
  return out;
}

/* -------------------------------------------------------------------- randevu */

export async function collectAppointmentDone(db: SupabaseClient, tenantId: string, sinceIso: string): Promise<EventCandidate[]> {
  const { data, error } = await db
    .from("appointments")
    .select("id, customer_id, property_id, assigned_to, scheduled_at, updated_at, appointment_type")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .eq("is_sample", false)
    .in("appointment_type", ["showing", "valuation"])
    .not("customer_id", "is", null)
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(CAP);
  if (error) {
    console.error("anket: tamamlanan randevular", error.message);
    return [];
  }
  const rows = data ?? [];
  const [custs, props] = await Promise.all([
    customersById(db, tenantId, [...new Set(rows.map((r) => String(r.customer_id)))]),
    propertiesById(db, tenantId, [...new Set(rows.map((r) => r.property_id).filter((v): v is string => Boolean(v)))]),
  ]);
  const out: EventCandidate[] = [];
  for (const r of rows) {
    const cust = custs.get(String(r.customer_id));
    if (!usableCustomer(cust)) continue;
    const p = r.property_id ? props.get(String(r.property_id)) : undefined;
    if (p?.is_sample) continue;
    out.push({
      eventType: "appointment_done",
      audience: "visitor",
      eventKey: eventKey("appointment_done", String(r.id), "visitor"),
      summary: `${r.appointment_type === "valuation" ? "Değerleme görüşmesi" : "Mülk ziyareti"}${p ? `: ${propLabel(p)}` : ""}`,
      eventAt: String(r.updated_at),
      customerId: cust.id,
      propertyId: (r.property_id as string | null) ?? null,
      agentId: (r.assigned_to as string | null) ?? null,
    });
  }
  return out;
}

export async function collectFor(
  db: SupabaseClient,
  tenantId: string,
  event: SurveyEventType,
  sinceIso: string,
  todayDate: string,
): Promise<EventCandidate[]> {
  switch (event) {
    case "property_unpublished":
      return collectPropertyUnpublished(db, tenantId, sinceIso, todayDate);
    case "deal_won":
      return collectDealWon(db, tenantId, sinceIso);
    case "deal_lost":
      return collectDealLost(db, tenantId, sinceIso);
    case "demand_lost":
      return collectDemandLost(db, tenantId, sinceIso);
    case "appointment_done":
      return collectAppointmentDone(db, tenantId, sinceIso);
    case "authority_extended":
      // Olay kaynağı yok (yetki bitiş tarihi geçmişi tutulmuyor): görev, tarih uzatılırken
      // `updatePropertyAuthorization` kancasından anında üretilir.
      return [];
  }
}
