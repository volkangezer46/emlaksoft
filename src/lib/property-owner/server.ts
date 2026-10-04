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

  const input: OwnerInfoInput = {
    ...emptyOwnerInfo(),
    ownerCustomerId: customerId,
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

/**
 * Yayın kapısı (vitrin/portal/durum=yayında): engel metni veya null.
 *  1) İlan havuzda (bekleyen kayıt) ise atanana dek yayınlanamaz.
 *  2) İlan sahibi kaydı VAR ve eksik zorunlu alan varsa yayınlanamaz.
 * Tablolar yoksa (migration uygulanmamış) veya kayıt yoksa kapı uygulanmaz: mevcut akış bozulmaz.
 */
export async function publishBlockReason(db: SupabaseClient, tenantId: string, propertyId: string): Promise<string | null> {
  const { count, error: poolError } = await db
    .from("listing_pool_entries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .eq("status", "pending");
  if (!poolError && (count ?? 0) > 0) return "İlan havuzda bekliyor; bir danışmana atanmadan yayına alınamaz.";
  const view = await loadOwnerInfo(db, tenantId, propertyId);
  if (!view || view.evaluation.complete) return null;
  return `İlan sahibi bilgileri eksik (%${view.evaluation.score}): ${view.evaluation.missing.map((m) => m.label).join("; ")}.`;
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
