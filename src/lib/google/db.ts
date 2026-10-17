import "server-only";
import { getPlatformSettingsMany, setPlatformSetting } from "@/lib/platform-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import type { AdsDailyRow } from "./ads";
import type { GscRow } from "./gsc";
import type { KwPair } from "@/lib/seo/keywords";
import type { InspectionRecord, InspectionResult } from "./url-inspection";
import type { SettingsPort } from "./token-store";

/**
 * Google verisinin SUNUCU deposu (service_role). Tablolar tenant verisi değildir (platformun kendi sitesi ve reklam
 * hesabı); RLS açık, politika yok → yalnız service_role. Tek `createAdminClient` noktası `db()`'dir.
 * Tablo yoksa (migration 20261013003400 uygulanmadı) okuyucular boş döner, yazıcılar hatayı çağırana iletir.
 */

function db() {
  return createAdminClient();
}

const CHUNK = 1000;

/** Üretim ayar portu: okuma sıkı (okunamadı ≠ kayıt yok), yazma write_setting RPC'si ile gizli kayıt (geçmişte değer YOK). */
export const platformSettingsPort: SettingsPort = {
  async read(keys) {
    return getPlatformSettingsMany(keys, { strict: true });
  },
  async write(key, sealed, meta) {
    return setPlatformSetting(key, sealed, meta.actorId ?? undefined, {
      scope: "platform",
      isSecret: true,
      actorType: meta.actorId ? "platform_staff" : "system",
      fingerprint: meta.fingerprint,
      summary: meta.summary,
    });
  },
  async remove(key) {
    const { error } = await db().from("platform_settings").delete().eq("key", key);
    if (error) console.error("google ayar silme", key, error.message);
    return !error;
  },
};

export type TableResult = { ok: true; count: number } | { ok: false; error: string };

async function upsertChunks(table: string, rows: readonly object[], onConflict: string): Promise<TableResult> {
  const client = db();
  let count = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const { error } = await client.from(table).upsert(part as never[], { onConflict });
    if (error) return { ok: false, error: error.message };
    count += part.length;
  }
  return { ok: true, count };
}

export function upsertGscRows(rows: readonly GscRow[]): Promise<TableResult> {
  return upsertChunks("seo_gsc_daily", rows, "day,page,query,device");
}

export function upsertAdsRows(rows: readonly AdsDailyRow[]): Promise<TableResult> {
  return upsertChunks("ads_daily_metrics", rows, "day,campaign_id,ad_group_id");
}

export async function upsertInspection(r: InspectionResult, checkedAtIso: string): Promise<TableResult> {
  return upsertChunks("seo_url_inspections", [{ ...r, checked_at: checkedAtIso }], "url");
}

/** Son kayıtlı GSC günü (yeniden çekim penceresi için); tablo boşsa null. */
export async function lastGscDay(): Promise<string | null> {
  const { data, error } = await db().from("seo_gsc_daily").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.day as string | undefined) ?? null;
}

export async function lastAdsDay(): Promise<string | null> {
  const { data, error } = await db().from("ads_daily_metrics").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.day as string | undefined) ?? null;
}

export async function readInspectionIndex(): Promise<InspectionRecord[]> {
  const client = db();
  const res = await readAllPaged<InspectionRecord>((from, to) => client.from("seo_url_inspections").select("url, checked_at").order("url").range(from, to), {
    maxRows: 10_000,
  });
  if (res.error) throw new Error(res.error);
  return res.rows;
}

export type InspectionRow = InspectionResult & { checked_at: string };

export async function readInspections(limit = 500): Promise<InspectionRow[]> {
  const { data, error } = await db()
    .from("seo_url_inspections")
    .select("url, checked_at, verdict, coverage, google_canonical, user_canonical")
    .order("checked_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as InspectionRow[];
}

export type GscSummaryRow = { key: string; clicks: number; impressions: number; ctr: number; avg_position: number };

/** Ekran ve toplayıcı özeti (SQL tarafında toplanır). Hata/tablo yok → null (ekran "veri yok" der). */
export async function gscSummary(days: number, kind: "query" | "page", limit = 100): Promise<GscSummaryRow[] | null> {
  const { data, error } = await db().rpc("seo_gsc_summary", { p_days: days, p_kind: kind, p_limit: limit });
  if (error) return null;
  return ((data ?? []) as GscSummaryRow[]).map((r) => ({
    key: String(r.key),
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    ctr: Number(r.ctr) || 0,
    avg_position: Number(r.avg_position) || 0,
  }));
}

export async function readAdsRows(sinceDay: string): Promise<AdsDailyRow[] | null> {
  const client = db();
  const res = await readAllPaged<AdsDailyRow>(
    (from, to) =>
      client
        .from("ads_daily_metrics")
        .select("day, campaign_id, campaign, ad_group_id, ad_group, cost_micros, clicks, impressions, conversions, conv_value, budget_limited")
        .gte("day", sinceDay)
        .order("day", { ascending: false })
        .order("campaign_id")
        .order("ad_group_id")
        .range(from, to),
    { maxRows: 50_000 },
  );
  if (res.error) return null;
  return res.rows.map((r) => ({ ...r, cost_micros: Number(r.cost_micros) || 0 }));
}

/** Atıflı kayıtlar: utm_campaign bazında sayım (Google kaynaklı; büyük/küçük harf duyarsız eşleştirme ekranda). */
export async function attributedSignups(sinceIso: string): Promise<Array<{ utm_campaign: string; count: number }> | null> {
  const client = db();
  type Row = { utm_campaign: string | null; utm_source: string | null };
  const res = await readAllPaged<Row>(
    (from, to) =>
      client
        .from("signup_attributions")
        .select("utm_campaign, utm_source")
        .gte("created_at", sinceIso)
        .not("utm_campaign", "is", null)
        .order("tenant_id")
        .range(from, to),
    { maxRows: 50_000 },
  );
  if (res.error) return null;
  const counts = new Map<string, number>();
  for (const r of res.rows) {
    const src = (r.utm_source ?? "").toLowerCase();
    if (src && !src.includes("google")) continue;
    const key = (r.utm_campaign ?? "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([utm_campaign, count]) => ({ utm_campaign, count }));
}

export async function pruneGoogleData(): Promise<number> {
  const { data, error } = await db().rpc("google_data_prune");
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

/** `seo_gsc_keyword_pairs` sonucu (SAF analizler src/lib/seo/keywords.ts). Fonksiyon yoksa `available: false`. */
export type KeywordPairsResult = { available: boolean; rows: KwPair[] };

export async function gscKeywordPairs(days: number, limit = 3000): Promise<KeywordPairsResult> {
  const { data, error } = await db().rpc("seo_gsc_keyword_pairs", { p_days: days, p_limit: limit });
  if (error) return { available: !["PGRST202", "42883", "42P01", "PGRST205"].includes(String(error.code ?? "")), rows: [] };
  const n = (v: unknown) => Number(v) || 0;
  const pos = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  type Raw = Record<string, unknown>;
  return {
    available: true,
    rows: ((data ?? []) as Raw[]).map((r) => ({
      query: String(r.query ?? ""),
      page: String(r.page ?? ""),
      clicks: n(r.clicks),
      impressions: n(r.impressions),
      position: pos(r.avg_position),
      prevClicks: n(r.prev_clicks),
      prevImpressions: n(r.prev_impressions),
      prevPosition: pos(r.prev_position),
    })),
  };
}
