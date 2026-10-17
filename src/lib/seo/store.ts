import { unstable_cache } from "next/cache";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSetting, getPlatformSettingsMany, setPlatformSetting } from "@/lib/platform-settings";
import { resolvePageMetadata, resolveRootMetadata, type ExtraMetadata } from "./metadata";
import { buildRedirectMap, normalizeRedirectPath, withLegacyRedirects, type RedirectMap } from "./redirects";
import type { AuditSummary, Finding } from "./audit-rules";
import type { PageSnapshot } from "./page-snapshot";
import type { DropReason, PageScoreLite, ScoreCategory, SiteScore } from "./score";
import { isHistoryTracked, parseSeoHistory, pushSeoHistory } from "./history";
import {
  DEFAULT_SEO_GLOBAL,
  GlobalInputSchema,
  HubSettingsSchema,
  INDEXNOW_LOG_MAX,
  IndexNowLogSchema,
  IndexNowSettingsSchema,
  SeoAiSettingsSchema,
  mergeSeoAi,
  type IndexNowLogEntry,
  type SeoAiSettings,
  PagesSchema,
  PatternsSchema,
  RedirectsSchema,
  RobotsSettingsSchema,
  SEO_KEYS,
  SitemapSettingsSchema,
  mergeGlobal,
  mergeHubs,
  mergeIndexNow,
  mergePatterns,
  mergeRobots,
  mergeSitemap,
  safeParse,
  serializeSetting,
  type SeoGlobal,
  type SeoHubSettings,
  type SeoIndexNowSettings,
  type SeoPages,
  type SeoPatterns,
  type SeoRedirectRule,
  type SeoRobotsSettings,
  type SeoSitemapSettings,
} from "./schema";

/**
 * SEO ayarları depolama katmanı (sunucu). Okuma: tek sorgu + önbellek (etiket `seo-settings`);
 * yazma: şema + boyut doğrulama, yazdıktan sonra geri okuma. Önbellek düşürme (`updateTag`)
 * yalnız server action'larda çağrılır (src/app/actions/seo-admin.ts).
 * Ayar tablosu okunamazsa HER ŞEY bugünkü güvenli varsayılana düşer (site SEO'su bozulmaz).
 */

export const SEO_CACHE_TAG = "seo-settings";

export type SeoSettings = {
  global: SeoGlobal;
  pages: SeoPages;
  sitemap: SeoSitemapSettings;
  robots: SeoRobotsSettings;
  redirects: SeoRedirectRule[];
  /** Vitrin/ilan/danışman dinamik kalıpları (boş alan = bugünkü sabit çıktı). */
  patterns: SeoPatterns;
};

export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  global: DEFAULT_SEO_GLOBAL,
  pages: {},
  sitemap: mergeSitemap(null),
  robots: mergeRobots(null),
  redirects: [],
  patterns: mergePatterns(null),
};

function parseAll(raw: Record<string, string | null>): SeoSettings {
  return {
    global: mergeGlobal(safeParse(GlobalInputSchema, raw[SEO_KEYS.global] ?? null)),
    pages: safeParse(PagesSchema, raw[SEO_KEYS.pages] ?? null) ?? {},
    sitemap: mergeSitemap(safeParse(SitemapSettingsSchema, raw[SEO_KEYS.sitemap] ?? null)),
    robots: mergeRobots(safeParse(RobotsSettingsSchema, raw[SEO_KEYS.robots] ?? null)),
    redirects: safeParse(RedirectsSchema, raw[SEO_KEYS.redirects] ?? null) ?? [],
    patterns: mergePatterns(safeParse(PatternsSchema, raw[SEO_KEYS.patterns] ?? null)),
  };
}

const KEYS = [SEO_KEYS.global, SEO_KEYS.pages, SEO_KEYS.sitemap, SEO_KEYS.robots, SEO_KEYS.redirects, SEO_KEYS.patterns];

/** Önbelleksiz güncel ayarlar (yönetim ekranı). */
export async function readSeoSettingsFresh(): Promise<SeoSettings> {
  return parseAll(await getPlatformSettingsMany(KEYS));
}

/** Önbellekli ayarlar (public sayfalar, sitemap, robots). 5 dk TTL + yazmada etiket düşürme. */
export const getSeoSettings = unstable_cache(async (): Promise<SeoSettings> => readSeoSettingsFresh(), ["seo-settings-v1"], {
  tags: [SEO_CACHE_TAG],
  revalidate: 300,
});

/** Sayfa metadata'sı: ayarlar yoksa bugünkü değerler. `extra` dinamik sayfaların kendi verisidir. */
export async function buildMetadata(path: string, extra?: ExtraMetadata): Promise<Metadata> {
  const s = await getSeoSettings();
  return resolvePageMetadata(path, s.global, s.pages, extra);
}

export async function buildRootMetadata(): Promise<Metadata> {
  const s = await getSeoSettings();
  return resolveRootMetadata(s.global);
}

let redirectCache: { at: number; map: RedirectMap } | null = null;

/** Yönlendirme haritası (süreç içi 60 sn önbellek; yalnız 404 yolunda kullanılır). */
export async function getRedirectMap(nowMs: number): Promise<RedirectMap> {
  if (redirectCache && nowMs - redirectCache.at < 60_000) return redirectCache.map;
  const s = await getSeoSettings();
  const map = buildRedirectMap(withLegacyRedirects(s.redirects));
  redirectCache = { at: nowMs, map };
  return map;
}

export type WriteResult = { ok: true } | { ok: false; error: string };

/**
 * Şema + boyut doğrulayıp yazar ve geri okuyarak doğrular. Yönetici ayarlarında (history.ts SEO_HISTORY_KEYS)
 * yazmadan ÖNCE mevcut değer `seo.history` halkasına eklenir (değer değişmiyorsa eklenmez). Halka yazılamazsa
 * ayar yine kaydedilir (geçmiş, kaydı engellemez).
 */
export async function writeSeoSetting(
  keyName: keyof typeof SEO_KEYS,
  schema: Parameters<typeof serializeSetting>[1],
  value: unknown,
  staffId?: string,
  byName?: string | null,
): Promise<WriteResult> {
  const s = serializeSetting(keyName, schema, value);
  if (!s.ok) return s;
  if (isHistoryTracked(keyName)) await appendSeoHistory(keyName, s.json, staffId ?? null, byName ?? null);
  const ok = await setPlatformSetting(SEO_KEYS[keyName], s.json, staffId);
  if (!ok) return { ok: false, error: "Ayar kaydedilemedi: platform ayarları tablosuna yazılamadı." };
  const back = await getPlatformSetting(SEO_KEYS[keyName]);
  if (back !== s.json) return { ok: false, error: "Ayar yazıldı ama doğrulanamadı; tekrar deneyin." };
  return { ok: true };
}

async function appendSeoHistory(keyName: keyof typeof SEO_KEYS, nextJson: string, by: string | null, byName: string | null): Promise<void> {
  try {
    const cur = await getPlatformSettingsMany([SEO_KEYS[keyName], SEO_KEYS.history]);
    const prev = cur[SEO_KEYS[keyName]] ?? null;
    if (prev === nextJson) return;
    const at = new Date().toISOString();
    const id = `${at.replace(/\D/g, "").slice(0, 17)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const list = pushSeoHistory(parseSeoHistory(cur[SEO_KEYS.history] ?? null), { id, key: keyName, at, by, byName, prev });
    const ok = await setPlatformSetting(SEO_KEYS.history, JSON.stringify(list), by ?? undefined);
    if (!ok) console.error("seo.history yazılamadı", keyName);
  } catch (e) {
    console.error("seo.history", e);
  }
}

export async function readIndexNow(): Promise<SeoIndexNowSettings> {
  return mergeIndexNow(safeParse(IndexNowSettingsSchema, await getPlatformSetting(SEO_KEYS.indexnow)));
}

export async function writeIndexNow(value: SeoIndexNowSettings, staffId?: string): Promise<WriteResult> {
  return writeSeoSetting("indexnow", IndexNowSettingsSchema, value, staffId);
}

/** IndexNow anahtar dosyası için: yalnız ETKİNse ve anahtar eşleşirse true. */
export async function indexNowKeyMatches(key: string): Promise<boolean> {
  const s = await readIndexNow();
  return s.enabled && s.key.length === 32 && s.key === key;
}

/* ---------- AI önerisi ayarı ve IndexNow son bildirimler ---------- */

export async function readSeoAi(): Promise<SeoAiSettings> {
  return mergeSeoAi(safeParse(SeoAiSettingsSchema, await getPlatformSetting(SEO_KEYS.ai)));
}

export async function readIndexNowLog(): Promise<IndexNowLogEntry[]> {
  return safeParse(IndexNowLogSchema, await getPlatformSetting(SEO_KEYS.indexnowLog)) ?? [];
}

/** Yeni girdileri başa ekler, en çok 50 tutar. Yazma hatası gönderimi etkilemez (false döner). */
export async function appendIndexNowLog(entries: readonly IndexNowLogEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;
  try {
    const list = [...entries, ...(await readIndexNowLog())].slice(0, INDEXNOW_LOG_MAX);
    return await setPlatformSetting(SEO_KEYS.indexnowLog, JSON.stringify(list));
  } catch {
    return false;
  }
}

export async function readIndexNowSeen(): Promise<Set<string>> {
  const raw = await getPlatformSetting(SEO_KEYS.indexnowSeen);
  return new Set((raw ?? "").split(",").filter(Boolean));
}

export async function writeIndexNowSeen(seen: Set<string>, staffId?: string): Promise<boolean> {
  const value = [...seen].slice(-40000).join(",");
  return setPlatformSetting(SEO_KEYS.indexnowSeen, value, staffId);
}

/* ---------- Robot denetim kaydı ---------- */

export type AuditRun = {
  at: string;
  durationMs: number;
  trigger: "cron" | "manual";
  summary: AuditSummary;
  findings: Finding[];
  /** Sayfa adresi → h1 sayısı (kontrol listesi için). */
  h1: Record<string, number>;
  truncated: boolean;
  notes: string[];
  /** Bu koşuda taranan sayfa adresleri (sitemap + keşif). Eski kayıtlarda yok: okuyucu `h1` anahtarlarına düşer. */
  scanned?: string[];
  /** Sitemap dışından iç bağlantılarla keşfedilen sayfa sayısı. */
  discovered?: number;
};

export type AuditHistoryPoint = { at: string; critical: number; warning: number; info: number; pagesChecked: number };

export async function readAuditLatest(): Promise<AuditRun | null> {
  const raw = await getPlatformSetting(SEO_KEYS.auditLatest);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuditRun;
  } catch {
    return null;
  }
}

export async function readAuditHistory(): Promise<AuditHistoryPoint[]> {
  const raw = await getPlatformSetting(SEO_KEYS.auditHistory);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as AuditHistoryPoint[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const MAX_STORED_FINDINGS = 400;

/** `appendHistory: false`: yayın sonrası kısmi yeniden denetim trend grafiğine nokta eklemez. */
export async function writeAuditRun(run: AuditRun, opts: { appendHistory?: boolean } = {}): Promise<boolean> {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  const sorted = [...run.findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const trimmed: AuditRun = { ...run, findings: sorted.slice(0, MAX_STORED_FINDINGS), truncated: run.truncated || sorted.length > MAX_STORED_FINDINGS };
  let json = JSON.stringify(trimmed);
  // 256 KB sınırı: gerekirse bulgu sayısını azalt.
  while (new TextEncoder().encode(json).length > 250 * 1024 && trimmed.findings.length > 20) {
    trimmed.findings = trimmed.findings.slice(0, Math.floor(trimmed.findings.length / 2));
    trimmed.truncated = true;
    json = JSON.stringify(trimmed);
  }
  const ok = await setPlatformSetting(SEO_KEYS.auditLatest, json);
  if (opts.appendHistory === false) return ok;
  const history = await readAuditHistory();
  history.push({ at: run.at, ...pickCounts(run.summary) });
  await setPlatformSetting(SEO_KEYS.auditHistory, JSON.stringify(history.slice(-60)));
  return ok;
}

function pickCounts(s: AuditSummary) {
  return { critical: s.critical, warning: s.warning, info: s.info, pagesChecked: s.pagesChecked };
}

/* ---------- 404 kayıtları (seo_404_hits tablosu; migration yoksa sessizce atlanır) ---------- */

export type NotFoundRow = { path: string; hits: number; last_seen_at: string; first_seen_at: string; referrer_host: string | null };

const pending404 = new Map<string, { n: number; ref: string | null }>();
let last404Flush = 0;
let table404Missing = false;
const MAX_PENDING_404 = 200;

/** Token benzeri (uzun, rastgele) parça içeren yollar kaydedilmez. */
export function isLoggable404Path(path: string): boolean {
  if (!path.startsWith("/") || path.length > 300 || /[?#]/.test(path)) return false;
  // Otomatik güvenlik tarayıcı gürültüsü (wp-admin, .php, .env...) listeyi boğmasın.
  if (/\.(php\d*|asp|aspx|jsp|env|git|sql|bak|zip|tar|gz|ini|yml|yaml)(\/|$)|wp-|xmlrpc|\.well-known|phpmyadmin|cgi-bin/i.test(path)) return false;
  return !path.split("/").some((seg) => /^[A-Za-z0-9_-]{24,}$/.test(seg));
}

/** Yerel/iç ağ yönlendireni (sağlık kontrolü, sunucu içi istek): 404 listesine yazılmaz. */
export function isLocalReferrerHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) h = h.slice(1, h.indexOf("]") > 0 ? h.indexOf("]") : undefined);
  else if (h.split(":").length === 2) h = h.split(":")[0]!; // ana makine:port
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0";
}

/**
 * 404'ü bellekte biriktirir, en çok 15 sn'de bir toplu yazar (her istekte DB yazısı yok).
 * Başarısızlık asla isteği etkilemez.
 */
export async function logNotFound(path: string, referrerHost: string | null, nowMs: number): Promise<void> {
  try {
    if (table404Missing || !isLoggable404Path(path) || isLocalReferrerHost(referrerHost)) return;
    const key = normalizeRedirectPath(path);
    const cur = pending404.get(key);
    if (cur) cur.n += 1;
    else if (pending404.size < MAX_PENDING_404) pending404.set(key, { n: 1, ref: referrerHost });
    if (nowMs - last404Flush < 15_000) return;
    last404Flush = nowMs;
    const batch = [...pending404.entries()];
    pending404.clear();
    const admin = createAdminClient();
    for (const [p, v] of batch) {
      const { error } = await admin.rpc("seo_log_404", { p_path: p, p_referrer_host: v.ref, p_inc: v.n });
      if (error) {
        // 42883: fonksiyon yok, 42P01: tablo yok -> migration uygulanmamış; bir daha deneme.
        if (error.code === "42883" || error.code === "PGRST202" || error.code === "42P01") table404Missing = true;
        return;
      }
    }
  } catch {
    // sessiz
  }
}

export async function listNotFound(limit = 100): Promise<{ available: boolean; rows: NotFoundRow[] }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("seo_404_hits")
      .select("path, hits, last_seen_at, first_seen_at, referrer_host")
      .order("hits", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(limit);
    if (error) return { available: false, rows: [] };
    return { available: true, rows: (data ?? []) as NotFoundRow[] };
  } catch {
    return { available: false, rows: [] };
  }
}

export async function prune404(): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.rpc("seo_prune_404", { p_keep_days: 90, p_max_rows: 2000 });
  } catch {
    // sessiz
  }
}

/* ---------- Sayfa anlık görüntüleri ve SEO puanı (sistem kayıtları, seo.audit.*) ---------- */

/** Sistem anahtarları: `seo.audit.*` öneki ayar geçmişinde "sistem kaydı" sayılır (settings/system-keys.ts). */
export const SEO_SCORE_KEYS = { pages: "seo.audit.pages", scores: "seo.audit.scores" } as const;

const MAX_SNAPSHOT_BYTES = 250 * 1024;

export async function writeAuditPages(pages: readonly PageSnapshot[]): Promise<boolean> {
  let list = [...pages];
  let json = JSON.stringify({ at: new Date().toISOString(), pages: list });
  while (new TextEncoder().encode(json).length > MAX_SNAPSHOT_BYTES && list.length > 10) {
    list = list.slice(0, Math.floor(list.length * 0.8));
    json = JSON.stringify({ at: new Date().toISOString(), pages: list });
  }
  return setPlatformSetting(SEO_SCORE_KEYS.pages, json);
}

export async function readAuditPages(): Promise<{ at: string; pages: PageSnapshot[] } | null> {
  const raw = await getPlatformSetting(SEO_SCORE_KEYS.pages);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { at?: unknown; pages?: unknown };
    if (typeof v.at !== "string" || !Array.isArray(v.pages)) return null;
    return { at: v.at, pages: v.pages as PageSnapshot[] };
  } catch {
    return null;
  }
}

export type ScoreHistoryPoint = { at: string; total: number; categories: Record<ScoreCategory, number | null> };

export type SeoScoreState = {
  at: string;
  site: SiteScore;
  pages: PageScoreLite[];
  drop: DropReason[];
  history: ScoreHistoryPoint[];
};

export const SCORE_HISTORY_MAX = 90;

export async function readSeoScores(): Promise<SeoScoreState | null> {
  const raw = await getPlatformSetting(SEO_SCORE_KEYS.scores);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SeoScoreState;
    return v && typeof v.at === "string" && v.site && Array.isArray(v.pages) && Array.isArray(v.history) ? v : null;
  } catch {
    return null;
  }
}

export async function writeSeoScores(state: SeoScoreState): Promise<boolean> {
  return setPlatformSetting(SEO_SCORE_KEYS.scores, JSON.stringify({ ...state, history: state.history.slice(-SCORE_HISTORY_MAX) }));
}

/* ---------- Programatik bölge sayfaları ayarı ---------- */

export async function readHubSettings(): Promise<SeoHubSettings> {
  return mergeHubs(safeParse(HubSettingsSchema, await getPlatformSetting(SEO_KEYS.hubs)));
}

/** Önbellekli (public /emlak sayfaları ve sitemap). Yazmada SEO_CACHE_TAG düşer. */
export const getHubSettings = unstable_cache(async (): Promise<SeoHubSettings> => readHubSettings(), ["seo-hubs-v1"], { tags: [SEO_CACHE_TAG], revalidate: 300 });
