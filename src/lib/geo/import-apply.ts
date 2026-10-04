/**
 * İçe aktarma UYGULAMA + GERİ ALMA — Supabase istemcisi dışarıdan verilir (admin paneli service_role
 * istemcisini, CLI kendi istemcisini geçirir); "server-only" DEĞİL ki tsx script de kullanabilsin.
 *
 * Güvence:
 *  - Önce sürüm kaydı açılır (geo_data_versions). Tablo yoksa UYGULANMAZ (geri alınamayan toplu yazım yok).
 *  - Parti parti ilerler; hata olursa dururuz, o ana dek yapılanlar sürüm kaydında durur → geri alınabilir.
 *  - SİLME YOK: eklenenler geri almada PASİFE alınır, güncellenenler eski değere döner,
 *    pasife alınanlar yeniden açılır. Referans kırılmaz.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { geoKey } from "./normalize";
import { chunk, type GeoOp, type ImportLevel, type ImportMeta, type ImportPlan } from "./import-plan";

const TABLE: Record<ImportLevel, string> = {
  province: "geo_provinces",
  district: "geo_districts",
  neighborhood: "geo_neighborhoods",
};

export type ImportChanges = {
  inserted: Record<ImportLevel, string[]>;
  updated: Array<{ level: ImportLevel; id: string; before: Record<string, unknown> }>;
  deactivated: Array<{ level: ImportLevel; id: string }>;
};

export type ApplyResult =
  | { ok: true; versionId: string; summary: ImportPlan["summary"] }
  | { ok: false; error: string; versionId: string | null };

const BATCH = 500;
const PARALLEL = 20;

/** Ekran/CLI: sürüm tablosu var mı? */
export async function geoVersionsAvailable(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from("geo_data_versions").select("id").limit(1);
  return !error;
}

export async function loadExistingGeo(client: SupabaseClient) {
  async function all<T>(table: string, cols: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select(cols).order("id").range(from, from + 999);
      if (error) throw new Error(`${table} okunamadı: ${error.message}`);
      out.push(...((data ?? []) as unknown as T[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  const [provinces, districts, neighborhoods] = await Promise.all([
    all<import("./import-plan").ExistingGeo["provinces"][number]>("geo_provinces", "id, plate_code, name, lat, lng, is_active"),
    all<import("./import-plan").ExistingGeo["districts"][number]>("geo_districts", "id, province_id, name, source_id, lat, lng, is_active"),
    all<import("./import-plan").ExistingGeo["neighborhoods"][number]>("geo_neighborhoods", "id, district_id, name, source_id, postal_code, is_active"),
  ]);
  return { provinces, districts, neighborhoods };
}

async function runParallel<T>(items: readonly T[], fn: (item: T) => Promise<string | null>): Promise<string | null> {
  for (const part of chunk(items, PARALLEL)) {
    const errs = await Promise.all(part.map(fn));
    const first = errs.find((e) => e);
    if (first) return first;
  }
  return null;
}

export async function applyImportPlan(
  client: SupabaseClient,
  plan: ImportPlan,
  ctx: { actorId: string | null; actorLabel: string; meta: ImportMeta; mode: "merge" | "full"; fileName?: string | null },
): Promise<ApplyResult> {
  if (plan.errors.length) return { ok: false, error: "Plan hatalı; uygulanamaz.", versionId: null };
  if (!(await geoVersionsAvailable(client))) {
    return { ok: false, error: "Sürüm tablosu bu ortamda yok (geo migration uygulanmamış); geri alınamayan toplu yazım yapılmaz.", versionId: null };
  }

  const changes: ImportChanges = { inserted: { province: [], district: [], neighborhood: [] }, updated: [], deactivated: [] };
  const { data: ver, error: verErr } = await client
    .from("geo_data_versions")
    .insert({
      kind: "import",
      source: ctx.meta.source || null,
      source_version: ctx.meta.version || null,
      source_date: ctx.meta.date && /^\d{4}-\d{2}-\d{2}$/.test(ctx.meta.date) ? ctx.meta.date : null,
      file_name: ctx.fileName ?? null,
      mode: ctx.mode,
      actor_id: ctx.actorId,
      actor_label: ctx.actorLabel,
      summary: { ...plan.summary, partial: true },
    })
    .select("id")
    .single();
  if (verErr || !ver) return { ok: false, error: "Sürüm kaydı açılamadı.", versionId: null };
  const versionId = ver.id as string;
  const source = ctx.meta.source || "import";

  const finish = async (error: string | null): Promise<ApplyResult> => {
    await client
      .from("geo_data_versions")
      .update({
        changes,
        status: error ? "failed" : "applied",
        summary: { ...plan.summary, partial: Boolean(error), ...(error ? { error } : {}) },
      })
      .eq("id", versionId);
    return error ? { ok: false, error, versionId } : { ok: true, versionId, summary: plan.summary };
  };

  const inserts = (level: ImportLevel) => plan.ops.filter((o): o is Extract<GeoOp, { op: "insert" }> => o.op === "insert" && o.level === level);
  const stamp = { source, version_id: versionId };

  try {
    // 1) iller
    const newProv = inserts("province");
    for (const part of chunk(newProv, BATCH)) {
      const { data, error } = await client
        .from("geo_provinces")
        .insert(part.map((o) => ({ plate_code: o.plate, name: o.name, lat: o.lat, lng: o.lng, population: o.population, ...stamp })))
        .select("id");
      if (error) return finish(`İl ekleme hatası: ${error.message}`);
      changes.inserted.province.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    }
    const { data: provRows, error: provErr } = await client.from("geo_provinces").select("id, plate_code");
    if (provErr) return finish(`İller okunamadı: ${provErr.message}`);
    const provIdByPlate = new Map((provRows as Array<{ id: string; plate_code: number }>).map((p) => [p.plate_code, p.id]));

    // 2) ilçeler
    const newDist = inserts("district");
    for (const part of chunk(newDist, BATCH)) {
      const payload = part.map((o) => ({ province_id: provIdByPlate.get(o.plate), name: o.name, source_id: o.sourceId, lat: o.lat, lng: o.lng, population: o.population, ...stamp }));
      if (payload.some((p) => !p.province_id)) return finish("İlçe için il bulunamadı (plaka eşleşmedi).");
      const { data, error } = await client.from("geo_districts").insert(payload).select("id");
      if (error) return finish(`İlçe ekleme hatası: ${error.message}`);
      changes.inserted.district.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    }

    // 3) mahalleler (ilçe kimliği: plaka + ilçe anahtarı)
    const newNeigh = inserts("neighborhood");
    if (newNeigh.length) {
      const existing = await loadExistingGeo(client);
      const plateByProvId = new Map(existing.provinces.map((p) => [p.id, p.plate_code]));
      const distIdByKey = new Map<string, string>();
      for (const d of existing.districts) distIdByKey.set(`${plateByProvId.get(d.province_id)}|${geoKey(d.name, "district")}`, d.id);
      for (const part of chunk(newNeigh, BATCH)) {
        const payload = part.map((o) => ({
          district_id: distIdByKey.get(`${o.plate}|${o.districtKey}`),
          name: o.name, source_id: o.sourceId, postal_code: o.postalCode, lat: o.lat, lng: o.lng, population: o.population, ...stamp,
        }));
        if (payload.some((p) => !p.district_id)) return finish("Mahalle için ilçe bulunamadı.");
        const { data, error } = await client.from("geo_neighborhoods").insert(payload).select("id");
        if (error) return finish(`Mahalle ekleme hatası: ${error.message}`);
        changes.inserted.neighborhood.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
      }
    }

    // 4) güncellemeler (+ eski ad → alias)
    const updates = plan.ops.filter((o): o is Extract<GeoOp, { op: "update" }> => o.op === "update");
    const aliasRows: Array<Record<string, unknown>> = [];
    const upErr = await runParallel(updates, async (o) => {
      const { error } = await client.from(TABLE[o.level]).update({ ...o.after, version_id: versionId }).eq("id", o.id);
      if (error) return `Güncelleme hatası (${o.path}): ${error.message}`;
      changes.updated.push({ level: o.level, id: o.id, before: o.before });
      if (o.aliasFrom) {
        aliasRows.push({ level: o.level, entity_id: o.id, alias: o.aliasFrom, alias_key: geoKey(o.aliasFrom), kind: "old_name", version_id: versionId, created_by: ctx.actorId });
      }
      return null;
    });
    if (upErr) return finish(upErr);
    for (const part of chunk(aliasRows, BATCH)) {
      const { error } = await client.from("geo_aliases").upsert(part, { onConflict: "level,entity_id,alias_key", ignoreDuplicates: true });
      if (error) return finish(`Alias yazılamadı: ${error.message}`);
    }

    // 5) pasife alma
    const deact = plan.ops.filter((o): o is Extract<GeoOp, { op: "deactivate" }> => o.op === "deactivate");
    for (const level of ["neighborhood", "district"] as ImportLevel[]) {
      const ids = deact.filter((o) => o.level === level).map((o) => o.id);
      for (const part of chunk(ids, 200)) {
        const { error } = await client.from(TABLE[level]).update({ is_active: false, deactivated_at: new Date().toISOString(), version_id: versionId }).in("id", part);
        if (error) return finish(`Pasife alma hatası: ${error.message}`);
        changes.deactivated.push(...part.map((id) => ({ level, id })));
      }
    }
    return finish(null);
  } catch (e) {
    return finish(`Beklenmeyen hata: ${e instanceof Error ? e.message : "bilinmiyor"}`);
  }
}

/** İçe aktarma sürümünü geri alır (referans kırmadan: silme yok). */
export async function rollbackImportVersion(client: SupabaseClient, versionId: string, actorId: string | null): Promise<{ ok: true; reverted: number } | { ok: false; error: string }> {
  const { data: v, error } = await client.from("geo_data_versions").select("id, kind, status, changes").eq("id", versionId).maybeSingle();
  if (error || !v) return { ok: false, error: "Sürüm bulunamadı." };
  if (v.kind !== "import") return { ok: false, error: "Yalnız içe aktarma sürümleri bu yolla geri alınır." };
  if (v.status === "rolled_back") return { ok: false, error: "Bu sürüm zaten geri alınmış." };
  const ch = v.changes as ImportChanges;
  let reverted = 0;
  for (const level of ["neighborhood", "district", "province"] as ImportLevel[]) {
    for (const part of chunk(ch.inserted?.[level] ?? [], 200)) {
      const { error: e } = await client.from(TABLE[level]).update({ is_active: false, deactivated_at: new Date().toISOString() }).in("id", part);
      if (e) return { ok: false, error: `Geri alma hatası: ${e.message}` };
      reverted += part.length;
    }
  }
  const react = (ch.deactivated ?? []);
  for (const level of ["district", "neighborhood"] as ImportLevel[]) {
    for (const part of chunk(react.filter((r) => r.level === level).map((r) => r.id), 200)) {
      const { error: e } = await client.from(TABLE[level]).update({ is_active: true, deactivated_at: null }).in("id", part);
      if (e) return { ok: false, error: `Geri alma hatası: ${e.message}` };
      reverted += part.length;
    }
  }
  const err = await runParallel(ch.updated ?? [], async (u) => {
    const { error: e } = await client.from(TABLE[u.level]).update(u.before).eq("id", u.id);
    if (!e) reverted++;
    return e ? `Geri alma hatası: ${e.message}` : null;
  });
  if (err) return { ok: false, error: err };
  await client.from("geo_aliases").delete().eq("version_id", versionId);
  await client.from("geo_data_versions").update({ status: "rolled_back", rolled_back_at: new Date().toISOString(), rolled_back_by: actorId }).eq("id", versionId);
  return { ok: true, reverted };
}
