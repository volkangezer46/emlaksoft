import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { compareTr } from "@/lib/tr-text";
import { geoKey } from "./normalize";
import { applyImportPlan, geoVersionsAvailable, loadExistingGeo, rollbackImportVersion } from "./import-apply";
import type { GeoLevel } from "./types";

/**
 * YÖNETİM VERİ KATMANI (yalnız /admin/geo ve geo action'ları). Yetki kontrolü ÇAĞIRANDA
 * (requirePlatformModule + rol), burada yok. Önbellek tazeleme action katmanında (updateTag).
 * SİLME YOK: pasife alma / birleştirme / taşıma vardır.
 */

const TABLE: Record<GeoLevel, string> = { province: "geo_provinces", district: "geo_districts", neighborhood: "geo_neighborhoods" };

export type AdminGeoRow = {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  lat: number | null;
  lng: number | null;
  plateCode: number | null;
  postalCode: string | null;
  population: number | null;
  sourceId: number | null;
  description: string | null;
  usage: number | null; // null = sayım altyapısı etkin değil
};

type Raw = Record<string, unknown>;
const toRow = (level: GeoLevel, r: Raw): AdminGeoRow => ({
  id: String(r.id),
  name: String(r.name),
  parentId: level === "province" ? null : String(level === "district" ? r.province_id : r.district_id),
  isActive: r.is_active !== false,
  lat: (r.lat as number | null) ?? null,
  lng: (r.lng as number | null) ?? null,
  plateCode: (r.plate_code as number | null) ?? null,
  postalCode: (r.postal_code as string | null) ?? null,
  population: (r.population as number | null) ?? null,
  sourceId: (r.source_id as number | null) ?? null,
  description: (r.description as string | null) ?? null,
  usage: null,
});

const COLS: Record<GeoLevel, string> = {
  province: "id, name, plate_code, lat, lng, is_active, population",
  district: "id, name, province_id, lat, lng, is_active, population, source_id",
  neighborhood: "id, name, district_id, lat, lng, is_active, population, source_id, postal_code",
};

// ------------------------------------------------------------------ listeleme

export async function listAdminRows(level: GeoLevel, opts: { parentId?: string; q?: string; status?: "active" | "inactive" | "all"; limit?: number }): Promise<{ rows: AdminGeoRow[]; total: number }> {
  const admin = createAdminClient();
  let query = admin.from(TABLE[level]).select(COLS[level], { count: "exact" });
  if (level === "district" && opts.parentId) query = query.eq("province_id", opts.parentId);
  if (level === "neighborhood" && opts.parentId) query = query.eq("district_id", opts.parentId);
  if (opts.status === "active") query = query.eq("is_active", true);
  if (opts.status === "inactive") query = query.eq("is_active", false);
  const q = (opts.q ?? "").trim();
  if (q) query = query.ilike("name", `%${q.replace(/[%_,()]/g, " ")}%`);
  const { data, count, error } = await query.order("name").limit(opts.limit ?? 1000);
  if (error || !data) return { rows: [], total: 0 };
  const rows = (data as unknown as Raw[]).map((r) => toRow(level, r));
  rows.sort(level === "province" ? (a, b) => (a.plateCode ?? 0) - (b.plateCode ?? 0) : (a, b) => compareTr(a.name, b.name));
  return { rows, total: count ?? rows.length };
}

export async function getAdminRow(level: GeoLevel, id: string): Promise<AdminGeoRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from(TABLE[level]).select(COLS[level]).eq("id", id).maybeSingle();
  return data ? toRow(level, data as unknown as Raw) : null;
}

/** Üst zincir adı (breadcrumb / etki özeti). */
export async function getPathLabel(level: GeoLevel, id: string): Promise<string> {
  const row = await getAdminRow(level, id);
  if (!row) return "";
  if (level === "province") return row.name;
  const parent = await getPathLabel(level === "district" ? "province" : "district", row.parentId ?? "");
  return parent ? `${parent} / ${row.name}` : row.name;
}

// ------------------------------------------------------------------ kullanım

const USAGE_LABEL: Record<string, string> = {
  properties: "ilan",
  customer_demands: "talep",
  customers: "müşteri",
  advisor_regions: "danışman bölgesi",
  tenants: "ofis",
  branches: "şube",
  projects: "proje",
  region_stats_history: "bölge istatistiği",
  geo_districts: "alt ilçe",
  geo_neighborhoods: "alt mahalle",
  demo_requests: "demo talebi",
  vitrin_events: "vitrin olayı",
  valuations: "değerleme",
};
export const usageLabel = (table: string) => USAGE_LABEL[table] ?? table;

export type UsageItem = { table: string; column: string; n: number };

/** null → sayım RPC'si yok (migration uygulanmadı). */
export async function usageBreakdown(level: GeoLevel, id: string): Promise<UsageItem[] | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("geo_usage_counts", { p_level: level, p_id: id });
  if (error) return null;
  return ((data ?? []) as Array<{ table_name: string; column_name: string; n: number | string }>).map((r) => ({ table: r.table_name, column: r.column_name, n: Number(r.n) }));
}

export async function usageTotals(level: GeoLevel, ids: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await admin.rpc("geo_usage_totals", { p_level: level, p_ids: ids.slice(i, i + 300) });
    if (error) return null;
    for (const r of (data ?? []) as Array<{ id: string; n: number | string }>) out.set(r.id, (out.get(r.id) ?? 0) + Number(r.n));
  }
  return out;
}

export type UsageRowItem = { id: string; tenant_id: string | null; label: string; created_at: string | null };
export async function usageRows(level: GeoLevel, id: string, table: string): Promise<UsageRowItem[] | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("geo_usage_rows", { p_level: level, p_id: id, p_table: table, p_limit: 50 });
  if (error) return null;
  return (data ?? []) as UsageRowItem[];
}

export async function attachUsage(level: GeoLevel, rows: AdminGeoRow[]): Promise<AdminGeoRow[]> {
  const totals = await usageTotals(level, rows.map((r) => r.id));
  if (!totals) return rows;
  return rows.map((r) => ({ ...r, usage: totals.get(r.id) ?? 0 }));
}

// -------------------------------------------------------------------- yazma

export type WriteResult = { ok: true; id?: string } | { ok: false; error: string };

const dupMsg = (code: string | undefined, fallback: string) => (code === "23505" ? "Aynı üst kayıt altında bu adla bir kayıt zaten var." : fallback);

export type EntityInput = {
  name: string;
  parentId?: string;
  plateCode?: number | null;
  lat?: number | null;
  lng?: number | null;
  postalCode?: string | null;
  description?: string | null;
};

async function addAliasInternal(level: GeoLevel, entityId: string, alias: string, kind: "old_name" | "variant" | "merged", actorId: string | null, validTo?: string | null): Promise<void> {
  const admin = createAdminClient();
  await admin.from("geo_aliases").upsert(
    { level, entity_id: entityId, alias, alias_key: geoKey(alias), kind, valid_to: validTo ?? null, created_by: actorId },
    { onConflict: "level,entity_id,alias_key", ignoreDuplicates: true },
  ); // tablo yoksa hata yutulur: yazım yine de geçer
}

export async function createEntity(level: GeoLevel, input: EntityInput, actorId: string): Promise<WriteResult> {
  const admin = createAdminClient();
  const base: Raw = { name: input.name, lat: input.lat ?? null, lng: input.lng ?? null };
  if (level === "province") {
    if (!input.plateCode || input.plateCode < 1 || input.plateCode > 81) return { ok: false, error: "Plaka kodu 1-81 arasında olmalı." };
    base.plate_code = input.plateCode;
  } else {
    if (!input.parentId) return { ok: false, error: "Üst kayıt gerekli." };
    base[level === "district" ? "province_id" : "district_id"] = input.parentId;
  }
  if (level === "neighborhood") base.postal_code = input.postalCode ?? null;
  if (input.description) base.description = input.description;
  base.source = "manual";
  let res = await admin.from(TABLE[level]).insert(base).select("id").single();
  if (res.error && /column .* does not exist|schema cache/i.test(res.error.message)) {
    delete base.description;
    delete base.source;
    res = await admin.from(TABLE[level]).insert(base).select("id").single();
  }
  if (res.error || !res.data) return { ok: false, error: dupMsg(res.error?.code, "Kayıt eklenemedi.") };
  void actorId;
  return { ok: true, id: res.data.id as string };
}

export async function updateEntity(level: GeoLevel, id: string, patch: { name?: string; lat?: number | null; lng?: number | null; postalCode?: string | null; plateCode?: number | null; description?: string | null }, actorId: string): Promise<WriteResult> {
  const admin = createAdminClient();
  const cur = await getAdminRow(level, id);
  if (!cur) return { ok: false, error: "Kayıt bulunamadı." };
  const upd: Raw = {};
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.lat !== undefined) upd.lat = patch.lat;
  if (patch.lng !== undefined) upd.lng = patch.lng;
  if (level === "neighborhood" && patch.postalCode !== undefined) upd.postal_code = patch.postalCode;
  if (level === "province" && patch.plateCode != null) {
    if (patch.plateCode < 1 || patch.plateCode > 81) return { ok: false, error: "Plaka kodu 1-81 arasında olmalı." };
    upd.plate_code = patch.plateCode;
  }
  let res = await admin.from(TABLE[level]).update(patch.description !== undefined ? { ...upd, description: patch.description } : upd).eq("id", id);
  if (res.error && patch.description !== undefined && /column .* does not exist|schema cache/i.test(res.error.message)) {
    res = await admin.from(TABLE[level]).update(upd).eq("id", id);
  }
  if (res.error) return { ok: false, error: dupMsg(res.error.code, "Kayıt güncellenemedi.") };
  // Ad değiştiyse eski ad otomatik alias (eski kayıtlar/yazımlar bulunabilsin).
  if (patch.name !== undefined && patch.name !== cur.name) await addAliasInternal(level, id, cur.name, "old_name", actorId);
  return { ok: true, id };
}

/** Pasife al / yeniden etkinleştir (toplu). Üst pasifse alt kayıtlar yeni seçimde zaten görünmez. */
export async function setActive(level: GeoLevel, ids: string[], active: boolean): Promise<WriteResult> {
  if (ids.length === 0) return { ok: false, error: "Kayıt seçilmedi." };
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    let res = await admin.from(TABLE[level]).update({ is_active: active, deactivated_at: active ? null : new Date().toISOString() }).in("id", part);
    if (res.error && /column .* does not exist|schema cache/i.test(res.error.message)) {
      res = await admin.from(TABLE[level]).update({ is_active: active }).in("id", part);
    }
    if (res.error) return { ok: false, error: "Durum güncellenemedi." };
  }
  return { ok: true };
}

export async function moveEntity(level: "district" | "neighborhood", id: string, newParentId: string): Promise<WriteResult> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("geo_move", { p_level: level, p_id: id, p_new_parent: newParentId });
  if (error) {
    if (/geo_move_conflict/.test(error.message)) return { ok: false, error: "Hedefte aynı ada sahip kayıt var." };
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return { ok: false, error: "Taşıma altyapısı bu ortamda etkin değil (geo migration uygulanmamış)." };
    return { ok: false, error: "Taşıma yapılamadı." };
  }
  return { ok: true };
}

export async function mergeEntity(level: "district" | "neighborhood", fromId: string, toId: string, actorId: string, actorLabel: string): Promise<WriteResult & { moved?: number; versionId?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("geo_merge", { p_level: level, p_from: fromId, p_to: toId, p_actor: actorId, p_actor_label: actorLabel });
  if (error) {
    if (/geo_merge_conflict/.test(error.message)) return { ok: false, error: "Birleştirme çakışması: hedefte aynı ada/anahtara sahip bir kayıt var." };
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return { ok: false, error: "Birleştirme altyapısı bu ortamda etkin değil (geo migration uygulanmamış)." };
    return { ok: false, error: "Birleştirme yapılamadı." };
  }
  const r = (data ?? {}) as { version_id?: string; moved_rows?: number };
  return { ok: true, moved: r.moved_rows ?? 0, versionId: r.version_id };
}

export async function undoMerge(versionId: string, actorId: string): Promise<WriteResult> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("geo_merge_undo", { p_version: versionId, p_actor: actorId });
  return error ? { ok: false, error: "Birleştirme geri alınamadı." } : { ok: true };
}

// -------------------------------------------------------------------- alias

export type AliasItem = { id: string; alias: string; kind: string; validTo: string | null };
export async function listAliases(level: GeoLevel, entityId: string): Promise<AliasItem[] | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("geo_aliases").select("id, alias, kind, valid_to").eq("level", level).eq("entity_id", entityId).order("created_at");
  if (error) return null;
  return ((data ?? []) as Array<{ id: string; alias: string; kind: string; valid_to: string | null }>).map((r) => ({ id: r.id, alias: r.alias, kind: r.kind, validTo: r.valid_to }));
}

export async function addAlias(level: GeoLevel, entityId: string, alias: string, kind: "old_name" | "variant", validTo: string | null, actorId: string): Promise<WriteResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("geo_aliases").insert({ level, entity_id: entityId, alias, alias_key: geoKey(alias), kind, valid_to: validTo, created_by: actorId });
  if (error) return { ok: false, error: error.code === "23505" ? "Bu takma ad zaten kayıtlı." : "Takma ad eklenemedi (alias tablosu etkin olmayabilir)." };
  return { ok: true };
}

export async function removeAlias(aliasId: string): Promise<WriteResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("geo_aliases").delete().eq("id", aliasId);
  return error ? { ok: false, error: "Takma ad silinemedi." } : { ok: true };
}

// ------------------------------------------------------------------ sürümler

export type VersionItem = {
  id: string; kind: string; source: string | null; sourceVersion: string | null; sourceDate: string | null;
  fileName: string | null; mode: string | null; actorLabel: string | null; status: string; createdAt: string;
  summary: Record<string, unknown>;
};

export async function listVersions(limit = 100): Promise<VersionItem[] | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("geo_data_versions")
    .select("id, kind, source, source_version, source_date, file_name, mode, actor_label, status, created_at, summary")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return null;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), kind: String(r.kind), source: (r.source as string) ?? null, sourceVersion: (r.source_version as string) ?? null,
    sourceDate: (r.source_date as string) ?? null, fileName: (r.file_name as string) ?? null, mode: (r.mode as string) ?? null,
    actorLabel: (r.actor_label as string) ?? null, status: String(r.status), createdAt: String(r.created_at), summary: (r.summary as Record<string, unknown>) ?? {},
  }));
}

export async function latestAppliedVersion(): Promise<VersionItem | null> {
  const list = await listVersions(20);
  return list?.find((v) => v.status === "applied" && v.kind === "import") ?? null;
}

export async function rollbackVersion(versionId: string, actorId: string): Promise<WriteResult & { reverted?: number }> {
  const admin = createAdminClient();
  const { data } = await admin.from("geo_data_versions").select("kind").eq("id", versionId).maybeSingle();
  if (data?.kind === "merge") return undoMerge(versionId, actorId);
  const r = await rollbackImportVersion(admin, versionId, actorId);
  return r.ok ? { ok: true, reverted: r.reverted } : { ok: false, error: r.error };
}

// --------------------------------------------------------------- içe aktarma

export async function loadExisting() {
  return loadExistingGeo(createAdminClient());
}

export async function applyPlan(plan: Parameters<typeof applyImportPlan>[1], ctx: Parameters<typeof applyImportPlan>[2]) {
  return applyImportPlan(createAdminClient(), plan, ctx);
}

export async function versionsAvailable(): Promise<boolean> {
  return geoVersionsAvailable(createAdminClient());
}

// -------------------------------------------------------------------- sağlık

export type GeoHealth = {
  totals: { provinces: number; districts: number; neighborhoods: number };
  active: { provinces: number; districts: number; neighborhoods: number };
  inactive: { provinces: number; districts: number; neighborhoods: number };
  provincesWithoutDistrict: Array<{ id: string; name: string }>;
  districtsWithoutNeighborhood: Array<{ id: string; name: string; provinceId: string }>;
  provinceCountOk: boolean;
  version: VersionItem | null;
  pendingRequests: number | null;
};

async function countOf(table: string, active?: boolean): Promise<number> {
  const admin = createAdminClient();
  let q = admin.from(table).select("id", { count: "exact", head: true });
  if (active !== undefined) q = q.eq("is_active", active);
  const { count } = await q;
  return count ?? 0;
}

export async function getGeoHealth(): Promise<GeoHealth> {
  const admin = createAdminClient();
  const [pa, pi, da, di, na, ni] = await Promise.all([
    countOf("geo_provinces", true), countOf("geo_provinces", false),
    countOf("geo_districts", true), countOf("geo_districts", false),
    countOf("geo_neighborhoods", true), countOf("geo_neighborhoods", false),
  ]);
  // Tutarsızlıklar: mevcut istatistik görünümlerinden (geo_province_stats / geo_district_stats).
  const [{ data: pstats }, { data: dstats }, { data: provs }, { data: dists }] = await Promise.all([
    admin.from("geo_province_stats").select("province_id, district_count"),
    admin.from("geo_district_stats").select("district_id, neighborhood_count"),
    admin.from("geo_provinces").select("id, name").eq("is_active", true),
    admin.from("geo_districts").select("id, name, province_id").eq("is_active", true).limit(5000),
  ]);
  const dc = new Map(((pstats ?? []) as Array<{ province_id: string; district_count: number }>).map((s) => [s.province_id, s.district_count]));
  const nc = new Map(((dstats ?? []) as Array<{ district_id: string; neighborhood_count: number }>).map((s) => [s.district_id, s.neighborhood_count]));
  const noDistrict = ((provs ?? []) as Array<{ id: string; name: string }>).filter((p) => (dc.get(p.id) ?? 0) === 0);
  const noNeigh = ((dists ?? []) as Array<{ id: string; name: string; province_id: string }>)
    .filter((d) => (nc.get(d.id) ?? 0) === 0)
    .map((d) => ({ id: d.id, name: d.name, provinceId: d.province_id }));
  const versions = await listVersions(20);
  const { count: pending, error: pendErr } = await admin.from("geo_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
  return {
    totals: { provinces: pa + pi, districts: da + di, neighborhoods: na + ni },
    active: { provinces: pa, districts: da, neighborhoods: na },
    inactive: { provinces: pi, districts: di, neighborhoods: ni },
    provincesWithoutDistrict: noDistrict,
    districtsWithoutNeighborhood: noNeigh,
    provinceCountOk: pa + pi === 81,
    version: versions?.find((v) => v.status === "applied" && v.kind === "import") ?? null,
    pendingRequests: pendErr ? null : pending ?? 0,
  };
}

// ---------------------------------------------------- ofis düzeltme bildirimi

export type ChangeRequestItem = {
  id: string; tenantId: string; tenantName: string | null; kind: string; proposedName: string; note: string | null;
  provinceId: string | null; districtId: string | null; neighborhoodId: string | null; status: string; createdAt: string; resolutionNote: string | null;
};

export async function listChangeRequests(status: "pending" | "approved" | "rejected" | "all"): Promise<ChangeRequestItem[] | null> {
  const admin = createAdminClient();
  let q = admin
    .from("geo_change_requests")
    .select("id, tenant_id, kind, proposed_name, note, province_id, district_id, neighborhood_id, status, created_at, resolution_note, tenant:tenants!geo_change_requests_tenant_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return null;
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const t = r.tenant as { name?: string } | Array<{ name?: string }> | null;
    const tenantName = Array.isArray(t) ? t[0]?.name : t?.name;
    return {
      id: String(r.id), tenantId: String(r.tenant_id), tenantName: tenantName ?? null, kind: String(r.kind), proposedName: String(r.proposed_name),
      note: (r.note as string) ?? null, provinceId: (r.province_id as string) ?? null, districtId: (r.district_id as string) ?? null,
      neighborhoodId: (r.neighborhood_id as string) ?? null, status: String(r.status), createdAt: String(r.created_at), resolutionNote: (r.resolution_note as string) ?? null,
    };
  });
}

export async function resolveChangeRequest(id: string, status: "approved" | "rejected", staffId: string, note: string | null): Promise<WriteResult> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("geo_change_requests")
    .update({ status, resolved_by: staffId, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("id", id)
    .eq("status", "pending");
  return error ? { ok: false, error: "Bildirim güncellenemedi." } : { ok: true };
}

export async function getChangeRequest(id: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("geo_change_requests").select("id, kind, proposed_name, province_id, district_id, neighborhood_id, status").eq("id", id).maybeSingle();
  return data as { id: string; kind: string; proposed_name: string; province_id: string | null; district_id: string | null; neighborhood_id: string | null; status: string } | null;
}
