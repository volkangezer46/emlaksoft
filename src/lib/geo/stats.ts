import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingFunctionError } from "@/lib/supabase/rpc-probe";
import type { GeoLevel } from "./types";

/**
 * Geo sayim gorunumleri (YD7, migration 20261015047010): geo_province_stats / geo_district_stats / geo_level_counts
 * MATERIALIZED VIEW'dir; okuma ucuz, tazelik `refresh_geo_stats()` ile saglanir. Yenileyenler: operational-retention
 * cron'unun `geoStats` adimi (gunluk) ve /admin/geo yazimlari (admin-store). Istemci CAGIRANDAN gelir (service_role);
 * bu dosya yeni createAdminClient acmaz.
 */

type GeoStatsClient = Pick<SupabaseClient, "rpc" | "from">;

export const REFRESH_GEO_STATS_RPC = "refresh_geo_stats";

/** Gorunumleri tazeler. Fonksiyon yoksa (migration uygulanmadi) `skipped`; baska hata fırlatır (cron adimi hata yazar). */
export async function refreshGeoStats(client: GeoStatsClient): Promise<{ refreshed: true; provinces: number | null; districts: number | null } | { skipped: true }> {
  const { data, error } = await client.rpc(REFRESH_GEO_STATS_RPC);
  if (error) {
    if (isMissingFunctionError(error)) return { skipped: true };
    throw new Error(`refresh_geo_stats failed: ${error.code ?? "?"}`);
  }
  const r = (data ?? {}) as { provinces?: unknown; districts?: unknown };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { refreshed: true, provinces: n(r.provinces), districts: n(r.districts) };
}

/**
 * Yazim sonrasi tazeleme: yazim zaten basarili; tazeleme hatasi kullaniciya hata olarak DONMEZ (gece cron'u yeniden dener),
 * yalniz gunluge duser.
 */
export async function refreshGeoStatsQuietly(client: GeoStatsClient): Promise<void> {
  try {
    await refreshGeoStats(client);
  } catch (e) {
    console.error("refreshGeoStats", e instanceof Error ? e.message : e);
  }
}

export type GeoLevelCounts = Record<GeoLevel, { active: number; inactive: number }>;

/** geo_level_counts satirlarini seviye x aktiflik tablosuna cevirir; bicim bozuksa null (cagiran eski sayima duser). */
export function parseGeoLevelCounts(rows: unknown): GeoLevelCounts | null {
  if (!Array.isArray(rows)) return null;
  const out: GeoLevelCounts = {
    province: { active: 0, inactive: 0 },
    district: { active: 0, inactive: 0 },
    neighborhood: { active: 0, inactive: 0 },
  };
  for (const raw of rows as Array<{ level?: unknown; active?: unknown; n?: unknown }>) {
    const level = raw?.level;
    if (level !== "province" && level !== "district" && level !== "neighborhood") return null;
    const n = typeof raw.n === "string" ? Number(raw.n) : raw.n;
    if (typeof n !== "number" || !Number.isFinite(n) || typeof raw.active !== "boolean") return null;
    out[level][raw.active ? "active" : "inactive"] += n;
  }
  return out;
}

/** Tek okuma: 6 sayim (il/ilce/mahalle x aktif/pasif). Gorunum yoksa/hata verirse null. */
export async function readGeoLevelCounts(client: GeoStatsClient): Promise<GeoLevelCounts | null> {
  try {
    const { data, error } = await client.from("geo_level_counts").select("level, active, n");
    if (error) return null;
    return parseGeoLevelCounts(data);
  } catch {
    return null;
  }
}
