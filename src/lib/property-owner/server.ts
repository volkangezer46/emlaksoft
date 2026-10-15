import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyOwnerInfo, evaluateOwnerInfo, isMissingSchemaError, type OwnerInfoEvaluation, type OwnerInfoInput } from "./info";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export type OwnerInfoView = {
  propertyId: string;
  customer: { id: string; fullName: string; phone: string | null; email: string | null } | null;
  customerHidden: boolean;
  input: OwnerInfoInput;
  evaluation: OwnerInfoEvaluation;
  updatedAt: string | null;
  createdBy: string | null;
};

/**
 * İlan sahibi kaydını + mevcut yetki/komisyon/min fiyat alanlarını birleştirip güncel değerlendirmeyi üretir.
 * Tablo yoksa (migration uygulanmamış) veya satır yoksa null: çağıran taraf KAPI UYGULAMAZ (mevcut akış bozulmaz).
 * RLS gereği ofis yönetimi her ilanı, diğer danışmanlar yalnız kendi ilanlarını okur.
 */
export async function loadOwnerInfo(db: SupabaseClient, tenantId: string, propertyId: string): Promise<OwnerInfoView | null> {
  const { data, error } = await db
    .from("property_owner_info")
    .select(
      "property_id, customer_id, relation, deed_status, deed_note, commission_kind, negotiation_margin_pct, listing_source, customer_notes, contact_history, kvkk_consent, contact_permission, updated_at, created_by",
    )
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchemaError(error)) console.error("loadOwnerInfo", { code: error.code });
    return null;
  }
  if (!data) return null;
  const row = data as Row;

  const { data: prop } = await db
    .from("properties")
    .select("authorization_type, authorization_start, authorization_end, min_price")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const p = (prop ?? {}) as Row;

  let customer: OwnerInfoView["customer"] = null;
  let customerHidden = false;
  const customerId = str(row.customer_id);
  if (customerId) {
    const { data: c } = await db.from("customers").select("id, full_name, phone, email").eq("id", customerId).eq("tenant_id", tenantId).maybeSingle();
    if (c) {
      const cr = c as Row;
      customer = { id: str(cr.id), fullName: str(cr.full_name) || "Müşteri", phone: str(cr.phone) || null, email: str(cr.email) || null };
    } else customerHidden = true;
  }

  const input = ownerInputFromRows(row, p, customer);
  return {
    propertyId,
    customer,
    customerHidden,
    input,
    evaluation: evaluateOwnerInfo(input),
    updatedAt: str(row.updated_at) || null,
    createdBy: str(row.created_by) || null,
  };
}

/** property_owner_info satırı + portföyün yetki/min fiyat sütunları + (görünürse) müşteri → değerlendirme girdisi. */
function ownerInputFromRows(
  row: Row,
  p: Row,
  customer: { fullName: string; phone: string | null; email: string | null } | null,
): OwnerInfoInput {
  return {
    ...emptyOwnerInfo(),
    ownerCustomerId: str(row.customer_id),
    ownerName: customer?.fullName ?? "",
    ownerPhone: customer?.phone ?? "",
    ownerEmail: customer?.email ?? "",
    relation: str(row.relation),
    deedStatus: str(row.deed_status),
    deedNote: str(row.deed_note),
    authorizationType: str(p.authorization_type),
    authorizationStart: str(p.authorization_start).slice(0, 10),
    authorizationEnd: str(p.authorization_end).slice(0, 10),
    commissionKind: str(row.commission_kind) || "yuzde",
    minPrice: numOrNull(p.min_price),
    negotiationMarginPct: numOrNull(row.negotiation_margin_pct),
    listingSource: str(row.listing_source),
    customerNotes: str(row.customer_notes),
    contactHistory: str(row.contact_history),
    kvkkConsent: row.kvkk_consent === true,
    contactPermission: row.contact_permission === true,
    // Müşteri görünmüyorsa (kapsam dışı) telefonun var olduğu varsayılmaz: kapı tutucu davranır.
    existingOwnerHasPhone: Boolean(customer?.phone),
  };
}

export const PUBLISH_GATE_POOL_MESSAGE = "İlan havuzda bekliyor; bir danışmana atanmadan yayına alınamaz.";
export const PUBLISH_GATE_LOCATION_MESSAGE = "Konum eksik: il ve ilçe seçilmeden yayına alınamaz.";
export const PUBLISH_GATE_NO_OWNER_MESSAGE =
  "İlan sahibi kaydı yok: sahibin müşteri kaydı, ilişki, tapu, yetki türü, ilan kaynağı ve KVKK onayı girilmeden yayına alınamaz.";
const PUBLISH_GATE_ERROR_MESSAGE = "Yayın kapısı denetlenemedi; lütfen tekrar deneyin.";

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Toplu yayın kapısı (B163): her portföy için engel metni (engelsizler haritada YOK).
 * Kural ('live' için; tekil, toplu, portal ve RPC yolunda aynı — DB kopyası `transition_property_status_atomic`):
 *  1) İlan havuzda (bekleyen kayıt) ise atanana dek yayınlanamaz.
 *  2) İl ve ilçe seçilmiş olmalı.
 *  3) TAMAMLANMIŞ ilan sahibi kaydı olmalı (kayıt yoksa da engel — eskiden "kayıt yoksa kapı yok" açığı vardı).
 * Sorgu sayısı ilan sayısından bağımsız: 3 sorgu, tek paralel tur (havuz, portföy sütunları, sahip kaydı+müşteri).
 * Sorgu hatasında kapı kapalı kalır (fail-closed).
 */
export type PublishBlock = { reason: string; label: string };

export async function publishBlockReasons(
  db: SupabaseClient,
  tenantId: string,
  propertyIds: readonly string[],
): Promise<Map<string, PublishBlock>> {
  const ids = [...new Set(propertyIds.filter(Boolean))];
  const out = new Map<string, PublishBlock>();
  if (!ids.length) return out;
  const [pool, props, owners] = await Promise.all([
    db.from("listing_pool_entries").select("property_id").eq("tenant_id", tenantId).in("property_id", ids).eq("status", "pending"),
    db
      .from("properties")
      .select("id, property_code, province_id, district_id, authorization_type, authorization_start, authorization_end, min_price")
      .eq("tenant_id", tenantId)
      .in("id", ids)
      .is("deleted_at", null),
    db
      .from("property_owner_info")
      .select(
        "property_id, customer_id, relation, deed_status, deed_note, commission_kind, negotiation_margin_pct, listing_source, customer_notes, contact_history, kvkk_consent, contact_permission, customer:customers!property_owner_info_customer_tenant_fkey(full_name, phone, email)",
      )
      .eq("tenant_id", tenantId)
      .in("property_id", ids),
  ]);
  if (props.error || owners.error) {
    console.error("publishBlockReasons", { props: props.error?.code, owners: owners.error?.code });
    for (const id of ids) out.set(id, { reason: PUBLISH_GATE_ERROR_MESSAGE, label: id.slice(0, 8) });
    return out;
  }
  const pooled = new Set(((pool.data ?? []) as Row[]).map((r) => str(r.property_id)));
  const propById = new Map(((props.data ?? []) as Row[]).map((r) => [str(r.id), r]));
  const ownerById = new Map(((owners.data ?? []) as Row[]).map((r) => [str(r.property_id), r]));
  for (const id of ids) {
    const p = propById.get(id);
    const label = str(p?.property_code) || id.slice(0, 8);
    if (!pool.error && pooled.has(id)) {
      out.set(id, { reason: PUBLISH_GATE_POOL_MESSAGE, label });
      continue;
    }
    if (!p) {
      out.set(id, { reason: "Portföy bulunamadı.", label });
      continue;
    }
    const reasons: string[] = [];
    if (!str(p.province_id) || !str(p.district_id)) reasons.push(PUBLISH_GATE_LOCATION_MESSAGE);
    const row = ownerById.get(id);
    if (!row) {
      reasons.push(PUBLISH_GATE_NO_OWNER_MESSAGE);
    } else {
      const c = first(row.customer as Row | Row[] | null);
      const customer = c ? { fullName: str(c.full_name) || "Müşteri", phone: str(c.phone) || null, email: str(c.email) || null } : null;
      const evaluation = evaluateOwnerInfo(ownerInputFromRows(row, p, customer));
      if (!evaluation.complete) {
        reasons.push(`İlan sahibi bilgileri eksik (%${evaluation.score}): ${evaluation.missing.map((m) => m.label).join("; ")}.`);
      }
    }
    if (reasons.length) out.set(id, { reason: reasons.join(" "), label });
  }
  return out;
}

/** Tek portföy için yayın kapısı: engel metni veya null (`publishBlockReasons` ile aynı kural ve sorgular). */
export async function publishBlockReason(db: SupabaseClient, tenantId: string, propertyId: string): Promise<string | null> {
  return (await publishBlockReasons(db, tenantId, [propertyId])).get(propertyId)?.reason ?? null;
}

/** Bir müşterinin ilan sahibi olduğu ilanlar (müşteri sayfası). Tablo yoksa boş. */
export async function loadOwnedProperties(
  db: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<{ propertyId: string; code: string; title: string; relation: string; complete: boolean }[]> {
  const { data, error } = await db
    .from("property_owner_info")
    .select("property_id, relation, is_complete")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .limit(50);
  if (error || !data?.length) return [];
  const ids = (data as Row[]).map((r) => str(r.property_id));
  const { data: props } = await db.from("properties").select("id, property_code, title").eq("tenant_id", tenantId).in("id", ids).is("deleted_at", null);
  const byId = new Map(((props ?? []) as Row[]).map((r) => [str(r.id), r]));
  return (data as Row[])
    .filter((r) => byId.has(str(r.property_id)))
    .map((r) => {
      const pr = byId.get(str(r.property_id)) as Row;
      return {
        propertyId: str(r.property_id),
        code: str(pr.property_code),
        title: str(pr.title) || str(pr.property_code) || "İlan",
        relation: str(r.relation),
        complete: r.is_complete === true,
      };
    });
}
