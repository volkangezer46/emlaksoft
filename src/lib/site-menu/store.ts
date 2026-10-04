import { unstable_cache } from "next/cache";
import { now } from "@/lib/clock";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { defaultSiteMenu } from "./defaults";
import { MEDIA_ID_RE, type MediaType } from "./media";
import { siteMenuSchema, type MediaInfo, type MediaKind, type SiteMenuConfig } from "./schema";

/**
 * Site menüsü depolama: mevcut `platform_settings` anahtar-değer tablosu (yeni migration gerekmez).
 *   sitemenu.live         -> yayındaki yapılandırma (yoksa varsayılan menü)
 *   sitemenu.draft        -> taslak (yoksa canlıyla aynı)
 *   sitemenu.history      -> son yayınlar: [{id,at,by,label,cfg}] (en yeni başta)
 *   sitemenu.media.index  -> yüklenen medya listesi (veri içermez)
 *   sitemenu.media.<id>   -> {type, enc, data}  (marka varlıklarıyla aynı depolama deseni)
 * Okuma/yazma yalnız src/lib/platform-settings.ts (kabul listesinde) üzerinden yapılır.
 */

export const SITE_MENU_CACHE_TAG = "site-menu";
const LIVE = "sitemenu.live";
const DRAFT = "sitemenu.draft";
const HISTORY = "sitemenu.history";
const MEDIA_INDEX = "sitemenu.media.index";
const mediaKey = (id: string) => `sitemenu.media.${id}`;

export const SITE_MENU_STORAGE_UNAVAILABLE =
  "Site menüsü kaydedilemedi: platform ayarları tablosuna yazılamadı. Veritabanı bağlantısını ve platform_settings tablosunu kontrol edin.";

export type MediaEntry = MediaInfo & { type: MediaType; kind: MediaKind; w: number | null; h: number | null; name: string; at: string };
export type HistoryEntry = { id: string; at: string; by: string; label: string; cfg: SiteMenuConfig };
export type StoredMedia = { type: MediaType; enc: "text" | "base64"; data: string };

const MAX_HISTORY = 10;
const MAX_HISTORY_BYTES = 600 * 1024;

export function parseConfig(raw: string | null): SiteMenuConfig | null {
  if (!raw) return null;
  try {
    const res = siteMenuSchema.safeParse(JSON.parse(raw));
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: HistoryEntry[] = [];
    for (const e of arr as Array<Partial<HistoryEntry>>) {
      if (typeof e?.id !== "string" || typeof e.at !== "string" || typeof e.label !== "string") continue;
      const cfg = siteMenuSchema.safeParse(e.cfg);
      if (!cfg.success) continue;
      out.push({ id: e.id, at: e.at, by: typeof e.by === "string" ? e.by : "", label: e.label, cfg: cfg.data });
    }
    return out;
  } catch {
    return [];
  }
}

export function parseMediaIndex(raw: string | null): MediaEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return (arr as Array<Partial<MediaEntry>>).filter(
      (m): m is MediaEntry =>
        typeof m?.id === "string" && MEDIA_ID_RE.test(m.id) && typeof m.type === "string" && typeof m.kind === "string" && typeof m.bytes === "number",
    );
  } catch {
    return [];
  }
}

/** Yayındaki menü (önbellekli). Ayar yok/bozuk/okunamıyorsa varsayılan menü: site bugünkü gibi çalışır. */
export const getLiveSiteMenu = unstable_cache(
  async (): Promise<SiteMenuConfig> => parseConfig(await getPlatformSetting(LIVE)) ?? defaultSiteMenu(),
  ["site-menu-live-v1"],
  { tags: [SITE_MENU_CACHE_TAG], revalidate: 300 },
);

export type AdminState = {
  live: SiteMenuConfig | null;
  draft: SiteMenuConfig | null;
  history: HistoryEntry[];
  media: MediaEntry[];
};

/** Önbelleksiz güncel durum (yönetim sayfası ve yazma yolu). */
export async function readAdminState(): Promise<AdminState> {
  const [live, draft, history, media] = await Promise.all([
    getPlatformSetting(LIVE),
    getPlatformSetting(DRAFT),
    getPlatformSetting(HISTORY),
    getPlatformSetting(MEDIA_INDEX),
  ]);
  return { live: parseConfig(live), draft: parseConfig(draft), history: parseHistory(history), media: parseMediaIndex(media) };
}

type Res = { ok: true } | { ok: false; error: string };

async function writeVerified(key: string, value: string | null, staffId: string): Promise<boolean> {
  if (!(await setPlatformSetting(key, value, staffId))) return false;
  return (await getPlatformSetting(key)) === value;
}

export async function saveDraft(cfg: SiteMenuConfig, staffId: string): Promise<Res> {
  return (await writeVerified(DRAFT, JSON.stringify(cfg), staffId)) ? { ok: true } : { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
}

function trimHistory(list: HistoryEntry[]): HistoryEntry[] {
  let out = list.slice(0, MAX_HISTORY);
  while (out.length > 1 && JSON.stringify(out).length > MAX_HISTORY_BYTES) out = out.slice(0, -1);
  return out;
}

/** Yapılandırmayı canlıya alır, taslağı eşitler ve sürüm geçmişine yazar. */
export async function publishConfig(
  cfg: SiteMenuConfig,
  entry: { id: string; at: string; by: string; label: string },
  staffId: string,
): Promise<Res> {
  const state = await readAdminState();
  const history = trimHistory([{ ...entry, cfg }, ...state.history]);
  const json = JSON.stringify(cfg);
  // Önce geçmiş (geri dönüş güvencesi), sonra canlı, en son taslak.
  if (!(await writeVerified(HISTORY, JSON.stringify(history), staffId))) return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  if (!(await writeVerified(LIVE, json, staffId))) return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  if (!(await writeVerified(DRAFT, json, staffId))) return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  await pruneMedia(staffId);
  return { ok: true };
}

/** Canlı yapılandırmayı siler (site varsayılan menüye döner) ve taslağı varsayılana eşitler. Eski canlı geçmişe yazılır. */
export async function resetToDefault(entry: { id: string; at: string; by: string }, staffId: string): Promise<Res> {
  const state = await readAdminState();
  if (state.live) {
    const history = trimHistory([{ ...entry, label: "Varsayılana dönmeden önceki yayın", cfg: state.live }, ...state.history]);
    if (!(await writeVerified(HISTORY, JSON.stringify(history), staffId))) return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  }
  if (!(await writeVerified(LIVE, null, staffId))) return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  if (!(await writeVerified(DRAFT, null, staffId))) return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  return { ok: true };
}

function referencedMedia(cfg: SiteMenuConfig | null, into: Set<string>) {
  if (!cfg) return;
  for (const g of cfg.groups) {
    for (const it of g.items) if (it.icon.kind === "media") into.add(it.icon.mediaId);
    if (g.featured?.media) {
      into.add(g.featured.media.mediaId);
      if (g.featured.media.posterId) into.add(g.featured.media.posterId);
    }
  }
}

export function collectMediaIds(...cfgs: Array<SiteMenuConfig | null>): Set<string> {
  const ids = new Set<string>();
  for (const c of cfgs) referencedMedia(c, ids);
  return ids;
}

/** Taslakta, canlıda ve geçmişte kullanılmayan medyayı depodan siler (depo şişmesin). */
export async function pruneMedia(staffId: string): Promise<void> {
  const state = await readAdminState();
  const used = collectMediaIds(state.live, state.draft, ...state.history.map((h) => h.cfg));
  // Yeni yüklenen (24 saatten genç) dosya henüz taslağa işlenmemiş olabilir; ona dokunulmaz.
  const fresh = (m: MediaEntry) => now() - Date.parse(m.at) < 24 * 3_600_000;
  const keep = state.media.filter((m) => used.has(m.id) || fresh(m));
  const drop = state.media.filter((m) => !used.has(m.id) && !fresh(m));
  if (drop.length === 0) return;
  if (!(await writeVerified(MEDIA_INDEX, JSON.stringify(keep), staffId))) return;
  for (const m of drop) await setPlatformSetting(mediaKey(m.id), null, staffId);
}

export async function saveMedia(entry: MediaEntry, stored: StoredMedia, staffId: string): Promise<Res> {
  const payload = JSON.stringify(stored);
  if (!(await writeVerified(mediaKey(entry.id), payload, staffId))) return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  const index = parseMediaIndex(await getPlatformSetting(MEDIA_INDEX));
  if (!(await writeVerified(MEDIA_INDEX, JSON.stringify([...index, entry]), staffId))) {
    await setPlatformSetting(mediaKey(entry.id), null, staffId);
    return { ok: false, error: SITE_MENU_STORAGE_UNAVAILABLE };
  }
  return { ok: true };
}

export async function readMediaIndex(): Promise<MediaEntry[]> {
  return parseMediaIndex(await getPlatformSetting(MEDIA_INDEX));
}

/** Yayın yolu: dosya içeriği (önbelleksiz; yanıt CDN'de değişmez önbelleklenir). */
export async function readStoredMedia(id: string): Promise<StoredMedia | null> {
  if (!MEDIA_ID_RE.test(id)) return null;
  const raw = await getPlatformSetting(mediaKey(id));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<StoredMedia>;
    if (typeof p.data !== "string" || (p.enc !== "text" && p.enc !== "base64") || typeof p.type !== "string") return null;
    return { type: p.type as MediaType, enc: p.enc, data: p.data };
  } catch {
    return null;
  }
}
