"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { daysAgoIso } from "@/lib/clock";
import { getAdapter, parseInventoryCsv } from "@/lib/listing-control/adapters";
import { isMissingSchema, chunk, type Db } from "@/lib/listing-control/server/db";
import { getControlSummary } from "@/lib/listing-control/server/readers";
import { featureFacts } from "@/lib/listing-control/duplicates";
import {
  buildInventoryBreakdown,
  INVENTORY_LIMITS,
  parsePastedList,
  rankUnregistered,
  rowsFromObserved,
  toObservations,
  toSummary,
  type CrmListing,
  type ImportSummary,
  type InventoryRow,
  type PropertyForMatch,
} from "@/lib/listing-control/inventory-import";

/**
 * Portal ENVANTERİ içe aktarma ve EŞLEŞME KUYRUĞU kararları. Hepsi `requirePermission("portals","edit")` kapısından geçer
 * ve KULLANICI OTURUMU istemcisiyle çalışır (service_role YOK): okuma RLS'li, yazım JWT kimlikli `lc_inventory_import` /
 * `lc_match_decide` RPC'leriyle (20261007000210). Karşılaştırma saf `inventory-import.ts` (compareInventory) içindedir.
 * Sunucu portala istek ATMAZ: liste kullanıcının yüklediği dosyadan/yapıştırdığından ya da kendi tarayıcısındaki
 * eklentinin okuduğu mağaza sayfasından gelir.
 */

export type InventoryImportResult =
  | {
      ok: true;
      summary: ImportSummary;
      applied: number;
      registered: number;
      opened: number;
      invalidTokens: string[];
      complete: boolean;
    }
  | { ok: false; error: string };

const MANAGER_ROLES = new Set(["owner", "gm", "branch_manager"]);
const MAX_TEXT = 3_500_000;

type ListingRow = { id: string; property_id: string; portal_listing_id: string | null; portal_url: string | null };
type PropRow = { id: string; property_code: string | null; list_price: number | null; assigned_to: string | null };

async function pagedListings(db: Db, portal: string): Promise<{ rows: ListingRow[]; failed: boolean }> {
  const rows: ListingRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db
      .from("portal_listings")
      .select("id, property_id, portal_listing_id, portal_url")
      .eq("status", "live")
      .ilike("portal_name", portal)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) return { rows, failed: true };
    rows.push(...((data ?? []) as ListingRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return { rows, failed: false };
}

async function loadCrm(db: Db, portal: string, scope: "mine" | "office", userId: string): Promise<CrmListing[] | null> {
  const listings = await pagedListings(db, portal);
  if (listings.failed) return null;
  const propIds = [...new Set(listings.rows.map((l) => l.property_id))];
  const props = new Map<string, PropRow>();
  for (const part of chunk(propIds, 200)) {
    const { data, error } = await db.from("properties").select("id, property_code, list_price, assigned_to").in("id", part).is("deleted_at", null);
    if (error) return null;
    for (const p of (data ?? []) as PropRow[]) props.set(p.id, p);
  }
  const advisorIds = [...new Set([...props.values()].map((p) => p.assigned_to).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (const part of chunk(advisorIds, 200)) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", part);
    for (const r of (data ?? []) as { id: string; full_name: string | null }[]) if (r.full_name) names.set(r.id, r.full_name);
  }
  const out: CrmListing[] = [];
  for (const l of listings.rows) {
    const p = props.get(l.property_id);
    if (!p) continue;
    if (scope === "mine" && p.assigned_to !== userId) continue;
    out.push({
      listingId: l.id,
      propertyId: l.property_id,
      propertyCode: p.property_code,
      externalId: l.portal_listing_id,
      url: l.portal_url,
      listPrice: p.list_price === null ? null : Number(p.list_price),
      advisorId: p.assigned_to,
      advisorName: p.assigned_to ? (names.get(p.assigned_to) ?? null) : null,
    });
  }
  return out;
}

type MatchPropRow = {
  id: string;
  property_code: string | null;
  title: string | null;
  address_line: string | null;
  list_price: number | null;
  features: Record<string, unknown> | null;
  parcel_block: string | null;
  parcel_lot: string | null;
  lat: number | null;
  lng: number | null;
  district_id: string | null;
  assigned_to: string | null;
};

async function loadMatchPool(db: Db, scope: "mine" | "office", userId: string): Promise<PropertyForMatch[]> {
  const out: PropertyForMatch[] = [];
  for (let from = 0; from < INVENTORY_LIMITS.maxRows; from += 1000) {
    let q = db
      .from("properties")
      .select("id, property_code, title, address_line, list_price, features, parcel_block, parcel_lot, lat, lng, district_id, assigned_to")
      .is("deleted_at", null)
      .not("is_sample", "is", true)
      .not("status", "in", "(sold,rented,withdrawn,passive,archived)")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (scope === "mine") q = q.eq("assigned_to", userId);
    const { data, error } = await q;
    if (error) break;
    for (const r of (data ?? []) as MatchPropRow[]) {
      const f = featureFacts(r.features);
      out.push({
        id: r.id,
        code: r.property_code,
        title: r.title,
        address: r.address_line,
        price: r.list_price === null ? null : Number(r.list_price),
        sqm: f.sqm,
        rooms: f.rooms,
        block: r.parcel_block,
        lot: r.parcel_lot,
        lat: r.lat,
        lng: r.lng,
        districtKey: r.district_id,
        advisorName: null,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

function rowsFromExtension(portal: string, items: unknown): InventoryRow[] {
  const adapter = getAdapter(portal);
  if (!Array.isArray(items) || !adapter) return [];
  const out: InventoryRow[] = [];
  const seen = new Set<string>();
  for (const raw of items.slice(0, INVENTORY_LIMITS.maxRows)) {
    const it = (raw ?? {}) as { externalId?: unknown; url?: unknown };
    const id = typeof it.externalId === "string" ? it.externalId.trim() : "";
    const url = typeof it.url === "string" ? it.url : null;
    const n = adapter.normalize({ url, externalId: id });
    if (!n || seen.has(n.externalId)) continue;
    seen.add(n.externalId);
    out.push({ externalId: n.externalId, url: n.url, title: null, price: null, advisorName: null, status: "active" });
  }
  return out;
}

export async function importPortalInventory(input: {
  portal: string;
  scope: "mine" | "office";
  source: "csv" | "paste" | "extension";
  complete: boolean;
  text?: string;
  items?: { externalId: string; url: string | null }[];
}): Promise<InventoryImportResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const portal = String(input.portal ?? "").trim().toLowerCase();
  if (!getAdapter(portal)) return { ok: false, error: "Portal seçin." };
  const scope = input.scope === "office" ? "office" : "mine";
  if (scope === "office" && !MANAGER_ROLES.has(gate.role)) return { ok: false, error: "Ofis geneli karşılaştırma yalnız yönetim kademesine açıktır." };
  const source = input.source === "csv" || input.source === "extension" ? input.source : "paste";
  const text = typeof input.text === "string" ? input.text : "";
  if (text.length > MAX_TEXT) return { ok: false, error: "Dosya çok büyük (en fazla 5000 ilan)." };

  let rows: InventoryRow[] = [];
  let invalidTokens: string[] = [];
  if (source === "csv") {
    rows = rowsFromObserved(parseInventoryCsv(portal, text, daysAgoIso(0), INVENTORY_LIMITS.maxRows));
    if (rows.length === 0) return { ok: false, error: "Dosyada ilan numarası sütunu bulunamadı (İlan No / İlan Numarası / ID başlığı gerekir)." };
  } else if (source === "paste") {
    const parsed = parsePastedList(portal, text);
    rows = parsed.rows;
    invalidTokens = parsed.invalid;
    if (rows.length === 0) return { ok: false, error: "Tanınan ilan numarası ya da ilan bağlantısı yok." };
  } else {
    rows = rowsFromExtension(portal, input.items);
    if (rows.length === 0) return { ok: false, error: "Eklenti listeden ilan okuyamadı." };
  }
  // Eklentiyle okunan liste ancak bütün sayfalar okunduysa tam sayılır; dosya/yapıştırmada kullanıcı onayı gerekir.
  const complete = Boolean(input.complete);

  const db = (await createClient()) as unknown as Db;
  const crm = await loadCrm(db, portal, scope, gate.userId);
  if (!crm) return { ok: false, error: "CRM ilanları okunamadı." };
  const summaryRes = await getControlSummary(db, scope === "mine" ? "advisor" : "tenant");
  const neverPublished = summaryRes.available
    ? scope === "mine"
      ? (summaryRes.rows.find((r) => r.group_id === gate.userId)?.awaiting_publish ?? 0)
      : summaryRes.rows.reduce((s, r) => s + r.awaiting_publish, 0)
    : 0;

  const breakdown = buildInventoryBreakdown({ portal, rows, crm, neverPublished });
  const observations = toObservations(breakdown, complete);
  const candidates = breakdown.unregistered.length ? rankUnregistered(breakdown.unregistered, await loadMatchPool(db, scope, gate.userId)) : [];
  const summary = toSummary(breakdown);

  const obsParts = chunk(observations, 2000);
  const candParts = chunk(candidates, 1000);
  const calls = Math.max(1, obsParts.length, candParts.length);
  let applied = 0;
  let registered = 0;
  let opened = 0;
  for (let i = 0; i < calls; i += 1) {
    const { data, error } = await db.rpc("lc_inventory_import", {
      p_portal: portal,
      p_scope: scope,
      p_source: source,
      p_complete: complete,
      p_observations: obsParts[i] ?? [],
      p_candidates: candParts[i] ?? [],
      p_summary: i === calls - 1 ? summary : null,
    });
    if (error) {
      console.error("lc_inventory_import", { code: error.code });
      return { ok: false, error: isMissingSchema(error) ? "Envanter içe aktarma için sistem güncellemesi bekleniyor." : "Karşılaştırma kaydedilemedi." };
    }
    const r = (data ?? {}) as { outcome?: string; observations_applied?: number; candidates_registered?: number; anomalies_opened?: number };
    if (r.outcome === "forbidden") return { ok: false, error: "Bu işlem için yetkiniz yok." };
    if (r.outcome !== "ok") return { ok: false, error: "Karşılaştırma kaydedilemedi." };
    applied += Number(r.observations_applied ?? 0);
    registered += Number(r.candidates_registered ?? 0);
    opened += Number(r.anomalies_opened ?? 0);
  }
  revalidatePath("/app/ilan-kontrol");
  revalidatePath("/app/ilan-kontrol/envanter");
  revalidatePath("/app/ilan-kontrol/eslesme");
  return { ok: true, summary, applied, registered, opened, invalidTokens, complete };
}

export type MatchDecisionResult = { ok?: boolean; error?: string };

const MATCH_ERRORS: Record<string, string> = {
  forbidden: "Eşleşme kararı yalnız yönetim kademesine açıktır.",
  not_open: "Bu aday artık açık değil.",
  invalid_input: "Geçersiz istek.",
  property_not_found: "Portföy bulunamadı.",
  bound_to_other_property: "Bu ilan numarası bu portalda başka bir portföye bağlı.",
  invalid_portal: "Portal adı geçersiz.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Eşleşme kuyruğu kararı: Onayla (aday portföye bağla) · Reddet · Başka portföy (portföy koduyla). */
export async function decidePortalMatch(formData: FormData): Promise<MatchDecisionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!MANAGER_ROLES.has(gate.role)) return { error: MATCH_ERRORS.forbidden };
  const candidateId = String(formData.get("candidate_id") ?? "").trim();
  const action = String(formData.get("action") ?? "").trim();
  let propertyId = String(formData.get("property_id") ?? "").trim();
  const propertyCode = String(formData.get("property_code") ?? "").trim();
  if (!UUID.test(candidateId) || (action !== "link" && action !== "ignore")) return { error: MATCH_ERRORS.invalid_input };
  const supabase = await createClient();
  if (action === "link" && !propertyId && propertyCode) {
    if (propertyCode.length > 40) return { error: MATCH_ERRORS.invalid_input };
    const { data } = await supabase.from("properties").select("id").eq("property_code", propertyCode).is("deleted_at", null).maybeSingle();
    propertyId = (data as { id?: string } | null)?.id ?? "";
    if (!propertyId) return { error: "Bu kodla portföy bulunamadı." };
  }
  if (action === "link" && !UUID.test(propertyId)) return { error: MATCH_ERRORS.invalid_input };
  const { data, error } = await supabase.rpc("lc_match_decide", {
    p_candidate_id: candidateId,
    p_action: action,
    p_property_id: action === "link" ? propertyId : null,
  });
  if (error) {
    console.error("lc_match_decide", { code: error.code });
    return { error: isMissingSchema(error) ? "Eşleşme kuyruğu için sistem güncellemesi bekleniyor." : "Karar kaydedilemedi." };
  }
  const outcome = String((data as { outcome?: string } | null)?.outcome ?? "");
  if (outcome !== "ok") return { error: MATCH_ERRORS[outcome] ?? "Karar kaydedilemedi." };
  revalidatePath("/app/ilan-kontrol/eslesme");
  revalidatePath("/app/ilan-kontrol/anomaliler");
  revalidatePath("/app/portallar");
  return { ok: true };
}
