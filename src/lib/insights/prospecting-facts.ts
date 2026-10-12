import type { SupabaseClient } from "@supabase/supabase-js";
import { InsightFactsUnavailable, isMissingSchemaError } from "@/lib/insights/facts";
import type { FsboFact } from "@/lib/insights/rules/prospecting";
import { leadHashCandidates } from "@/lib/prospecting/phone-hash";

/**
 * Sahibinden ilanlar içgörü olguları. Ofis sınırı AÇIK `tenant_id` filtresiyle (motor service_role ile çalışır, RLS yok);
 * örnek veri (`is_sample`), silinmiş ve kişisel verisi temizlenmiş kayıtlar elenir. Telefon/ad SEÇİLMEZ: içgörü
 * kanıtında kişisel veri yoktur. Tablo yoksa kural "etkin değil" sayılır.
 */
export const FSBO_FACT_LIMIT = 500;

type Row = {
  id: string;
  assigned_to: string | null;
  status: string;
  contact_attempts: number | null;
  first_seen_at: string;
  listed_at: string | null;
  last_contact_at: string | null;
  next_action_at: string | null;
  last_price_drop_at: string | null;
  last_price_drop_pct: number | string | null;
  relist_of: string | null;
  created_at: string;
  claim_expires_at: string | null;
  rooms: string | null;
  phone: string | null;
  phone_hash: string | null;
  district: { name: string | null } | { name: string | null }[] | null;
  assignee: { full_name: string | null } | { full_name: string | null }[] | null;
};

/** Aranmasın listesindeki özetler (ofis geneli; tablo yoksa süzgeçsiz devam). 200'lük parçalar. */
async function doNotCallHashes(admin: SupabaseClient, tenantId: string, hashes: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < hashes.length; i += 200) {
    const { data, error } = await admin.from("fsbo_do_not_call").select("phone_hash").eq("tenant_id", tenantId).in("phone_hash", hashes.slice(i, i + 200));
    if (error) {
      if (isMissingSchemaError(error)) return out;
      throw new Error(`fsbo_do_not_call: ${error.code ?? "hata"}`);
    }
    for (const r of (data ?? []) as { phone_hash: string }[]) out.add(r.phone_hash);
  }
  return out;
}

const ms = (v: string | null): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadProspectingFacts(admin: SupabaseClient, tenantId: string): Promise<{ facts: FsboFact[]; truncated: boolean }> {
  const { data, error } = await admin
    .from("fsbo_leads")
    .select(
      "id, assigned_to, status, contact_attempts, first_seen_at, listed_at, last_contact_at, next_action_at, last_price_drop_at, last_price_drop_pct, relist_of, created_at, claim_expires_at, rooms, phone, phone_hash, district:geo_districts!fsbo_leads_district_id_fkey(name), assignee:profiles!fsbo_leads_assigned_to_fkey(full_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("is_sample", false)
    .is("deleted_at", null)
    .in("status", ["yeni", "arandi", "randevu", "yetki_alindi"])
    .order("first_seen_at", { ascending: false })
    .limit(FSBO_FACT_LIMIT);
  if (error) {
    if (isMissingSchemaError(error)) throw new InsightFactsUnavailable("fsbo_leads");
    throw new Error(`fsbo_leads: ${error.code ?? "hata"}`);
  }
  const rows = (data ?? []) as unknown as Row[];
  // Aranmasın listesindeki ilan sahibi için "ara" içgörüsü üretilmez.
  // v1/v2 geçiş dönemi: telefon varsa iki özete de bakılır.
  const candidatesOf = (r: Row) => leadHashCandidates(tenantId, r.phone, r.phone_hash);
  const hashes = [...new Set(rows.flatMap(candidatesOf))];
  const dnc = hashes.length > 0 ? await doNotCallHashes(admin, tenantId, hashes) : new Set<string>();
  const facts = rows.filter((r) => !candidatesOf(r).some((h) => dnc.has(h))).map<FsboFact>((r) => ({
    id: r.id,
    assignedTo: r.assigned_to,
    assigneeName: first(r.assignee)?.full_name ?? null,
    status: r.status,
    contactAttempts: Number(r.contact_attempts ?? 0),
    firstSeenMs: ms(r.first_seen_at) ?? 0,
    listedAtMs: ms(r.listed_at),
    lastContactMs: ms(r.last_contact_at),
    nextActionMs: ms(r.next_action_at),
    lastPriceDropMs: ms(r.last_price_drop_at),
    lastPriceDropPct: r.last_price_drop_pct == null ? null : Number(r.last_price_drop_pct),
    relistOf: r.relist_of,
    createdMs: ms(r.created_at) ?? 0,
    claimExpiresMs: ms(r.claim_expires_at),
    districtName: first(r.district)?.name ?? null,
    rooms: r.rooms,
  }));
  return { facts, truncated: rows.length >= FSBO_FACT_LIMIT };
}
